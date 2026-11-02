import { LARGE_DATA_CACHE_MAX_BYTES } from '@shared/constants';

/** Stable references, bounded payload retention, and no cleanup/expiry timer. */
export class LargeDataStore extends Map<string, string> {
  private readonly idsByUrl = new Map<string, string>();
  private bytes = 0;
  private sequence = 0;

  register(url: string): string | undefined {
    const known = this.idsByUrl.get(url);
    if (known) return known;
    const bytes = url.length * 2;
    if (bytes > LARGE_DATA_CACHE_MAX_BYTES || this.bytes + bytes > LARGE_DATA_CACHE_MAX_BYTES) {
      return undefined;
    }
    const id = `data_${++this.sequence}`;
    this.set(id, url);
    this.idsByUrl.set(url, id);
    this.bytes += bytes;
    return id;
  }

  override clear(): void {
    super.clear();
    this.idsByUrl.clear();
    this.bytes = 0;
  }
}

export function registerLargeDataUrl(store: Map<string, string>, url: string): string | undefined {
  if (store instanceof LargeDataStore) return store.register(url);
  // Also support extractor callers supplying a plain Map (including unit tests).
  for (const [id, storedUrl] of store) if (storedUrl === url) return id;
  const usedBytes = Array.from(store.values()).reduce((sum, value) => sum + value.length * 2, 0);
  if (usedBytes + url.length * 2 > LARGE_DATA_CACHE_MAX_BYTES) return undefined;
  const id = `data_${store.size + 1}`;
  store.set(id, url);
  return id;
}

import { PAGE_COLLECTION_MAX_PAGES, MAX_ITEMS_PER_TAB } from '@shared/constants';
import { isSupportedAlbumUrl, normalizeAlbumPageUrl } from '@shared/album-utils';
import { detectPaginationScope, hasPaginationEvidence, normalizePaginationUrl, type PaginationLink } from '@shared/pagination-utils';
import type { RawCandidateGroup } from '@shared/types';

export interface CollectionPage {
  url: string;
  links: PaginationLink[];
  groups: RawCandidateGroup[];
}

export async function collectPages(options: {
  initial: CollectionPage;
  signal: AbortSignal;
  readPage: (url: string) => Promise<CollectionPage>;
  onPage: (page: CollectionPage) => Promise<void>;
  onProgress: (current: number, total: number, images: number) => void;
}): Promise<boolean> {
  const { initial, signal, readPage, onPage, onProgress } = options;
  const album = isSupportedAlbumUrl(initial.url);
  const scope = album ? undefined : detectPaginationScope(initial.url, initial.links);
  const normalize = (href: string, pageUrl = initial.url) => {
    try {
      const absolute = new URL(href, pageUrl).href;
      return scope ? normalizePaginationUrl(absolute, scope) : normalizeAlbumPageUrl(absolute, initial.url);
    } catch { return null; }
  };
  const firstUrl = normalize(initial.url)!;
  if (!initial.links.some((link) => (album || hasPaginationEvidence(link)) && normalize(link.href) && normalize(link.href) !== firstUrl)) {
    throw new Error('このページでは別ページへのページ送りを検出できませんでした');
  }
  const queue = [firstUrl];
  const scheduled = new Set(queue);
  let images = 0;
  let current = 0;
  let limited = false;
  while (current < queue.length) {
    signal.throwIfAborted();
    const url = queue[current]!;
    const page = current === 0 ? initial : await readPage(url);
    signal.throwIfAborted();
    if (normalize(page.url) !== url) throw new Error('別のページに移動したため収集を停止しました');
    if (album && page.groups.length === 0) throw new Error('本文の画像を取得できませんでした。ログイン状態やページの読み込み方式を確認してください');
    const remaining = MAX_ITEMS_PER_TAB - images;
    await onPage({ ...page, groups: page.groups.slice(0, remaining) });
    images += Math.min(remaining, page.groups.length);
    for (const link of page.links) {
      if (!album && !hasPaginationEvidence(link)) continue;
      const next = normalize(link.href, page.url);
      if (!next || scheduled.has(next)) continue;
      if (scheduled.size >= PAGE_COLLECTION_MAX_PAGES) { limited = true; continue; }
      scheduled.add(next); queue.push(next);
    }
    current++;
    onProgress(current, queue.length, images);
    if (images >= MAX_ITEMS_PER_TAB) { limited = true; break; }
  }
  return limited;
}

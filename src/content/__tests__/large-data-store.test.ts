import { describe, expect, it } from 'vitest';
import { LARGE_DATA_CACHE_MAX_BYTES } from '@shared/constants';
import { LargeDataStore, registerLargeDataUrl } from '../large-data-store';

describe('large data URL cache', () => {
  it('reuses the same reference across repeated scans', () => {
    const store = new LargeDataStore();
    const url = 'data:image/png;base64,' + 'a'.repeat(40_000);
    const first = registerLargeDataUrl(store, url);
    expect(registerLargeDataUrl(store, url)).toBe(first);
    expect(store.size).toBe(1);
    expect(store.get(first!)).toBe(url);
  });

  it('rejects overflow without retaining the payload and frees the budget on clear', () => {
    const store = new LargeDataStore();
    const url = 'x'.repeat(LARGE_DATA_CACHE_MAX_BYTES / 2);
    expect(store.register(url)).toBeDefined();
    expect(store.register('y')).toBeUndefined();
    expect(store.size).toBe(1);
    store.clear();
    expect(store.register('y')).toBeDefined();
    expect(store.size).toBe(1);
  });
});

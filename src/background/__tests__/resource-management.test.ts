import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CACHED_TAB_SESSIONS, STORAGE_KEYS } from '@shared/constants';
import type { RawCandidateGroup } from '@shared/types';
import { SessionStore } from '../session-store';

function group(index = 1): RawCandidateGroup {
  const url = `https://example.com/${index}.jpg`;
  return { occurrenceKey: `img_${index}`, primaryUrl: url, domOrder: index,
    variants: [{ url, role: 'src', source: 'img', naturalWidth: 100, naturalHeight: 100 }] };
}

describe('idle behavior and cache recovery', () => {
  let store: SessionStore;
  let data: Record<string, unknown>;
  let storage: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    data = {};
    storage = {
      get: vi.fn(async () => data),
      set: vi.fn(async (items) => { Object.assign(data, structuredClone(items)); }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      }),
    };
    vi.stubGlobal('chrome', { storage: { session: storage } });
    store = new SessionStore();
  });

  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('does not allocate, schedule timers, or write for unrelated tab reads/title changes', async () => {
    store.updatePageTitle(500, 'Unrelated title');
    expect(store.getSnapshot(500).scanStatus).toBe('unscanned');
    expect(store.getAllTrackedTabIds()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await store.flush();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('does not advance revisions or persist an identical candidate batch', async () => {
    store.mergeCandidateGroups(1, 1, [group()]);
    await store.flush();
    const revision = store.getSnapshot(1).revision;
    store.mergeCandidateGroups(1, 1, [group()]);
    expect(store.getSnapshot(1).revision).toBe(revision);
    expect(vi.getTimerCount()).toBe(0);
    await store.flush();
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it('coalesces sustained updates and stays timer-free after flushing', async () => {
    for (let i = 0; i < 20; i++) store.mergeCandidateGroups(1, 1, [group(i)]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(storage.set).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains dirty state after a storage failure and retries on the next flush', async () => {
    store.mergeCandidateGroups(1, 1, [group()]);
    storage.set.mockRejectedValueOnce(new Error('temporary storage failure'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.flush();
    expect(store.getSession(1)?.dirty).toBe(true);
    await store.flush();
    expect(store.getSession(1)?.dirty).toBe(false);
    expect(storage.set).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it('evicts inactive cache on quota errors while protecting visible tabs and downloads', async () => {
    store.setActiveTabs(new Set([1]));
    for (const id of [1, 2, 3]) store.mergeCandidateGroups(id, 1, [group(id)]);
    store.updateDownloadState(3, { itemId: 'item_1', targetUrl: group(3).primaryUrl,
      status: 'queued', retryable: false, updatedAt: 1 });
    storage.set.mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));
    await store.flush();
    expect(store.getAllTrackedTabIds().sort()).toEqual([1, 3]);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(data[`${STORAGE_KEYS.TAB_SESSION_PREFIX}1`]).toBeDefined();
    expect(data[`${STORAGE_KEYS.TAB_SESSION_PREFIX}3`]).toBeDefined();
  });

  it('bounds cached sessions while protecting selected targets and pending downloads', () => {
    store.setActiveTabs(new Set([1]));
    store.mergeCandidateGroups(1, 1, [group()]);
    store.mergeCandidateGroups(2, 1, [group()]);
    store.updateDownloadState(2, { itemId: 'item_1', targetUrl: group().primaryUrl,
      status: 'in_progress', retryable: false, updatedAt: 1 });
    for (let id = 3; id <= 12; id++) {
      vi.setSystemTime(id);
      store.mergeCandidateGroups(id, 1, [group(id)]);
    }
    expect(store.getAllTrackedTabIds()).toHaveLength(MAX_CACHED_TAB_SESSIONS);
    expect(store.getSession(1)).toBeDefined();
    expect(store.getSession(2)).toBeDefined();
    expect(store.getSession(12)).toBeDefined();
    expect(store.getSession(3)).toBeUndefined();
  });

  it('rejects stale batches after page replacement and preserves limit status', () => {
    store.resetSessionForNewPage(1, 'https://example.com/a');
    store.mergeCandidateGroups(1, 1, [group()]);
    const epoch = store.resetSessionForNewPage(1, 'https://example.com/b').scanEpoch;
    store.mergeCandidateGroups(1, epoch - 1, [group()]);
    expect(store.getSnapshot(1).items).toEqual([]);
    store.setScanStatus(1, 'limit_reached', 'Cache full');
    store.setScanStatus(1, 'watching');
    expect(store.getSnapshot(1).scanStatus).toBe('limit_reached');
  });

  it('bounds per-item variants and does not accumulate discarded URL aliases', () => {
    const candidate = group();
    candidate.variants = Array.from({ length: 100 }, (_, index) => ({
      url: `https://example.com/variant-${index}.jpg`, role: 'srcset', source: 'img',
      naturalWidth: null, naturalHeight: null,
    }));
    store.mergeCandidateGroups(1, 1, [candidate]);
    expect(store.getSnapshot(1).items[0]?.variants).toHaveLength(32);
    expect(store.getSession(1)?.itemByVariantUrl.size).toBeLessThanOrEqual(32);
    const revision = store.getSnapshot(1).revision;
    store.mergeCandidateGroups(1, 1, [candidate]);
    expect(store.getSnapshot(1).revision).toBe(revision);
  });

  it('stops intake when candidate metadata reaches the per-tab byte budget', () => {
    store.setActiveTabs(new Set([1]));
    for (let index = 0; index < 100; index++) {
      const candidate = group(index);
      const url = `${candidate.primaryUrl}?token=${'a'.repeat(20_000)}`;
      candidate.primaryUrl = url;
      candidate.variants[0]!.url = url;
      store.mergeCandidateGroups(1, 1, [candidate]);
    }
    expect(store.getSnapshot(1).items.length).toBeLessThan(100);
    expect(store.getSnapshot(1).scanStatus).toBe('limit_reached');
  });

  it('does not recreate a closed tab when an older storage write finishes late', async () => {
    store.mergeCandidateGroups(1, 1, [group()]);
    let finish!: () => void;
    storage.set.mockImplementationOnce((items) => new Promise<void>((resolve) => {
      finish = () => { Object.assign(data, structuredClone(items)); resolve(); };
    }));
    const writing = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    await store.removeTab(1);
    finish();
    await writing;
    expect(data[`${STORAGE_KEYS.TAB_SESSION_PREFIX}1`]).toBeUndefined();
  });

  it('keeps queued downloads after tab closure and releases the session after the final result', async () => {
    store.mergeCandidateGroups(1, 1, [group()]);
    const state = { itemId: 'item_1', targetUrl: group().primaryUrl, retryable: false, updatedAt: 1 };
    store.updateDownloadState(1, { ...state, status: 'queued' });
    await store.removeTab(1);
    expect(store.getSession(1)?.itemById.has('item_1')).toBe(true);
    store.updateDownloadState(1, { ...state, status: 'completed' });
    expect(store.getSession(1)).toBeUndefined();
  });
});

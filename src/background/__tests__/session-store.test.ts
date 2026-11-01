import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCandidateGroup } from '@shared/types';
import { SessionStore } from '../session-store';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Setup mock chrome API
    const sessionData: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        session: {
          get: vi.fn(async () => sessionData),
          set: vi.fn(async (items) => Object.assign(sessionData, items)),
          remove: vi.fn(async () => {}),
        },
      },
    };
    store = new SessionStore();
  });

  it('automatically selects high-resolution link-target URL as selectedUrl', () => {
    const tabId = 101;
    const groups: RawCandidateGroup[] = [
      {
        occurrenceKey: 'el_1::img::https://cdn.example.com/gallery/thumb.jpg',
        primaryUrl: 'https://cdn.example.com/gallery/thumb.jpg',
        domOrder: 1,
        variants: [
          {
            url: 'https://cdn.example.com/gallery/thumb.jpg',
            role: 'lazy-attr',
            source: 'lazy-attr',
            naturalWidth: null,
            naturalHeight: null,
          },
          {
            url: 'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
            role: 'link-target',
            source: 'link-href',
            naturalWidth: null,
            naturalHeight: null,
          },
        ],
      },
    ];

    store.mergeCandidateGroups(tabId, 1, groups);

    const snapshot = store.getSnapshot(tabId);
    expect(snapshot.items).toHaveLength(1);
    const item = snapshot.items[0]!;
    expect(item.primaryUrl).toBe('https://cdn.example.com/gallery/thumb.jpg');
    // Crucial check: selectedUrl should be the high-resolution link-target URL!
    expect(item.selectedUrl).toBe(
      'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
    );
    expect(item.variants).toHaveLength(2);
  });

  it('merges dynamically opened modal image into existing item without duplicating', () => {
    const tabId = 102;
    const initialGroups: RawCandidateGroup[] = [
      {
        occurrenceKey: 'el_1::img::https://cdn.example.com/gallery/thumb.jpg',
        primaryUrl: 'https://cdn.example.com/gallery/thumb.jpg',
        domOrder: 1,
        variants: [
          {
            url: 'https://cdn.example.com/gallery/thumb.jpg',
            role: 'lazy-attr',
            source: 'lazy-attr',
            naturalWidth: null,
            naturalHeight: null,
          },
          {
            url: 'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
            role: 'link-target',
            source: 'link-href',
            naturalWidth: null,
            naturalHeight: null,
          },
        ],
      },
    ];

    store.mergeCandidateGroups(tabId, 1, initialGroups);
    expect(store.getSnapshot(tabId).items).toHaveLength(1);

    // Now simulate user clicking the thumbnail, modal opens and adds <img> to DOM
    const modalGroups: RawCandidateGroup[] = [
      {
        occurrenceKey: 'el_99::img::https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
        primaryUrl: 'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
        domOrder: 99,
        variants: [
          {
            url: 'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
            role: 'current-src',
            source: 'img',
            naturalWidth: 1200,
            naturalHeight: 1800,
          },
        ],
      },
    ];

    store.mergeCandidateGroups(tabId, 1, modalGroups);

    // Should still have exactly 1 item (deduplicated across modal and thumbnail!)
    const snapshot = store.getSnapshot(tabId);
    expect(snapshot.items).toHaveLength(1);
    const item = snapshot.items[0]!;
    // And natural dimensions from modal are merged in!
    const fullVar = item.variants.find(
      (v) => v.url === 'https://images.example.com/get_image/2/sources/38344/photo.jpg/?i-acctoken=abc',
    );
    expect(fullVar?.naturalWidth).toBe(1200);
    expect(fullVar?.naturalHeight).toBe(1800);
  });

  it('allows batch switching between high-res and display variants', () => {
    const tabId = 103;
    const groups: RawCandidateGroup[] = [
      {
        occurrenceKey: 'el_1::img::thumb1.jpg',
        primaryUrl: 'https://example.com/thumb1.jpg',
        domOrder: 1,
        variants: [
          { url: 'https://example.com/thumb1.jpg', role: 'src', source: 'img', naturalWidth: null, naturalHeight: null },
          { url: 'https://example.com/orig1.jpg', role: 'link-target', source: 'link-href', naturalWidth: null, naturalHeight: null },
        ],
      },
      {
        occurrenceKey: 'el_2::img::thumb2.jpg',
        primaryUrl: 'https://example.com/thumb2.jpg',
        domOrder: 2,
        variants: [
          { url: 'https://example.com/thumb2.jpg', role: 'src', source: 'img', naturalWidth: null, naturalHeight: null },
          { url: 'https://example.com/orig2.jpg', role: 'link-target', source: 'link-href', naturalWidth: null, naturalHeight: null },
        ],
      },
    ];

    store.mergeCandidateGroups(tabId, 1, groups);
    let items = store.getSnapshot(tabId).items;
    expect(items[0]?.selectedUrl).toBe('https://example.com/orig1.jpg');
    expect(items[1]?.selectedUrl).toBe('https://example.com/orig2.jpg');

    // Switch all to display
    store.batchSelectVariants(tabId, 'display');
    items = store.getSnapshot(tabId).items;
    expect(items[0]?.selectedUrl).toBe('https://example.com/thumb1.jpg');
    expect(items[1]?.selectedUrl).toBe('https://example.com/thumb2.jpg');

    // Switch all to high_res
    store.batchSelectVariants(tabId, 'high_res');
    items = store.getSnapshot(tabId).items;
    expect(items[0]?.selectedUrl).toBe('https://example.com/orig1.jpg');
    expect(items[1]?.selectedUrl).toBe('https://example.com/orig2.jpg');
  });

  it('stores pageTitle and includes it in TabSessionSnapshot', () => {
    const tabId = 104;
    store.resetSessionForNewPage(tabId, 'https://example.com/gallery', 'scanning', 'My Gallery Title');

    let snapshot = store.getSnapshot(tabId);
    expect(snapshot.pageTitle).toBe('My Gallery Title');

    // Update via updatePageTitle
    store.updatePageTitle(tabId, 'Updated Gallery Title');
    snapshot = store.getSnapshot(tabId);
    expect(snapshot.pageTitle).toBe('Updated Gallery Title');

    // Update via mergeCandidateGroups
    store.mergeCandidateGroups(tabId, 2, [], 'Batch Title Override');
    snapshot = store.getSnapshot(tabId);
    expect(snapshot.pageTitle).toBe('Batch Title Override');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCandidateGroup, RawVideoCandidateGroup } from '@shared/types';
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

  it('merges video candidates, isolates image vs video selection, and enforces Readiness Gate', () => {
    const tabId = 201;
    store.resetSessionForNewPage(tabId, 'https://media.example.com/post', 'scanning', 'Media Post');

    const imgGroups: RawCandidateGroup[] = [
      {
        occurrenceKey: 'el_1::img::https://media.example.com/pic.jpg',
        primaryUrl: 'https://media.example.com/pic.jpg',
        domOrder: 1,
        variants: [
          {
            url: 'https://media.example.com/pic.jpg',
            role: 'src',
            source: 'img',
            naturalWidth: 800,
            naturalHeight: 600,
          },
        ],
      },
    ];

    const videoGroups: RawVideoCandidateGroup[] = [
      {
        occurrenceKey: 'el_2::video::https://media.example.com/clip_720.mp4',
        primaryUrl: 'https://media.example.com/clip_720.mp4',
        domOrder: 2,
        durationSec: 42,
        posterUrl: 'https://media.example.com/poster.jpg',
        variants: [
          {
            url: 'https://media.example.com/clip_720.mp4',
            role: 'source-tag',
            source: 'video-source',
            videoWidth: 1280,
            videoHeight: 720,
          },
          {
            url: 'https://media.example.com/clip_1080.mp4',
            role: 'source-tag',
            source: 'video-source',
            videoWidth: 1920,
            videoHeight: 1080,
          },
        ],
      },
      {
        occurrenceKey: 'net::resource::https://media.example.com/live/master.m3u8',
        primaryUrl: 'https://media.example.com/live/master.m3u8',
        domOrder: 3,
        durationSec: null,
        variants: [
          {
            url: 'https://media.example.com/live/master.m3u8',
            role: 'network',
            source: 'network-resource',
            videoWidth: null,
            videoHeight: null,
          },
        ],
      },
    ];

    store.mergeCandidateGroups(tabId, 1, imgGroups);
    store.mergeVideoCandidateGroups(tabId, 1, videoGroups, 'https://media.example.com/post');

    let snap = store.getSnapshot(tabId);
    expect(snap.items).toHaveLength(1);
    expect(snap.videos).toHaveLength(2);
    // Automatically picks 1080p MP4
    expect(snap.videos[0]?.selectedUrl).toBe('https://media.example.com/clip_1080.mp4');

    // Select image and select all videos -> HLS manifest (vid_2) MUST NOT be auto-selected!
    store.updateSelection(tabId, { mode: 'add_many', itemIds: ['item_1'] }, 'image');
    store.updateSelection(tabId, { mode: 'add_many', itemIds: ['vid_1', 'vid_2'] }, 'video');

    snap = store.getSnapshot(tabId);
    expect(snap.selectedIds).toEqual(['item_1']);
    expect(snap.selectedVideoIds).toEqual(['vid_1']);

    // Clearing video selection MUST NOT clear image selection!
    store.updateSelection(tabId, { mode: 'clear_all' }, 'video');
    snap = store.getSnapshot(tabId);
    expect(snap.selectedVideoIds).toEqual([]);
    expect(snap.selectedIds).toEqual(['item_1']);
  });
});

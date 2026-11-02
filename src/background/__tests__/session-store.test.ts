import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawCandidateGroup, RawVideoCandidateGroup } from '@shared/types';
import { NetworkVideoSniffer } from '../network-sniffer';
import { extractRequestDomainScope, parseHttpRefererAndOrigin } from '../referer-rules';
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

  it('merges 301-redirected CDN MP4 URLs via NetworkVideoSniffer without duplicating cards or downgrading HD', () => {
    let redirectListener:
      | ((details: chrome.webRequest.WebRedirectionResponseDetails) => void)
      | undefined;
    let headersListener:
      | ((details: chrome.webRequest.WebResponseHeadersDetails) => void)
      | undefined;

    const sessionData: Record<string, unknown> = {};
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        session: {
          get: vi.fn(async () => sessionData),
          set: vi.fn(async (items) => Object.assign(sessionData, items)),
          remove: vi.fn(async () => {}),
        },
      },
      webRequest: {
        onBeforeRedirect: {
          addListener: vi.fn((cb) => {
            redirectListener = cb;
          }),
          removeListener: vi.fn(() => {
            redirectListener = undefined;
          }),
        },
        onHeadersReceived: {
          addListener: vi.fn((cb) => {
            headersListener = cb;
          }),
          removeListener: vi.fn(() => {
            headersListener = undefined;
          }),
        },
      },
    };

    const sniffer = new NetworkVideoSniffer(store);
    sniffer.setWatchedTabs([301, 302]);
    expect(sniffer.isSniffing()).toBe(true);

    // Case 1: SD-only TokyoMotion video -> resolves to direct www47 .mp4 CDN URL
    const sdTabId = 301;
    store.resetSessionForNewPage(
      sdTabId,
      'https://www.tokyomotion.net/video/1234567/test',
      'watching',
      'Test Video',
    );
    store.mergeVideoCandidateGroups(
      sdTabId,
      1,
      [
        {
          occurrenceKey: 'el_1::video::sd',
          primaryUrl: 'https://www.tokyomotion.net/vsrc/sd/test-sd-source',
          domOrder: 1,
          durationSec: 285.05,
          posterUrl: 'https://cdn.tokyomotion.net/thumbs/1234567.jpg',
          variants: [
            {
              url: 'https://www.tokyomotion.net/vsrc/sd/test-sd-source',
              role: 'source-tag',
              source: 'video-source',
              descriptor: 'SD',
              mimeHint: 'video/mp4',
              videoWidth: null,
              videoHeight: null,
            },
          ],
        },
      ],
      'https://www.tokyomotion.net/video/1234567/test',
    );

    const resolvedSdCdnUrl =
      'https://www47.tokyomotion.net/video/test-cdn-path/test-session/iphone/1234567.mp4?md5=test&expires=2000000000';

    redirectListener?.({
      tabId: sdTabId,
      url: 'https://www.tokyomotion.net/vsrc/sd/test-sd-source',
      redirectUrl: resolvedSdCdnUrl,
      statusCode: 301,
    } as chrome.webRequest.WebRedirectionResponseDetails);

    headersListener?.({
      tabId: sdTabId,
      url: resolvedSdCdnUrl,
      statusCode: 206,
      responseHeaders: [
        { name: 'content-type', value: 'video/mp4' },
        { name: 'content-range', value: 'bytes 0-65535/13364887' },
      ],
    } as chrome.webRequest.WebResponseHeadersDetails);

    const sdSnap = store.getSnapshot(sdTabId);
    expect(sdSnap.videos).toHaveLength(1);
    expect(sdSnap.videos[0]?.selectedUrl).toBe(resolvedSdCdnUrl);
    expect(sdSnap.videos[0]?.variants.find((v) => v.url === resolvedSdCdnUrl)?.fileSizeBytes).toBe(
      13_364_887,
    );

    // Case 2: HD + SD video -> playing SD stream on page MUST NOT downgrade selected HD variant
    const hdTabId = 302;
    store.resetSessionForNewPage(
      hdTabId,
      'https://www.tokyomotion.net/video/7654321/hd-test',
      'watching',
      'HD Video',
    );
    store.mergeVideoCandidateGroups(
      hdTabId,
      1,
      [
        {
          occurrenceKey: 'el_1::video::hd',
          primaryUrl: 'https://www.tokyomotion.net/vsrc/sd/111111',
          domOrder: 1,
          durationSec: 120,
          variants: [
            {
              url: 'https://www.tokyomotion.net/vsrc/sd/111111',
              role: 'source-tag',
              source: 'video-source',
              descriptor: 'SD',
              mimeHint: 'video/mp4',
              videoWidth: null,
              videoHeight: null,
            },
            {
              url: 'https://www.tokyomotion.net/vsrc/hd/222222',
              role: 'source-tag',
              source: 'video-source',
              descriptor: 'HD',
              mimeHint: 'video/mp4',
              videoWidth: null,
              videoHeight: null,
            },
          ],
        },
      ],
      'https://www.tokyomotion.net/video/7654321/hd-test',
    );

    redirectListener?.({
      tabId: hdTabId,
      url: 'https://www.tokyomotion.net/vsrc/sd/111111',
      redirectUrl: 'https://www47.tokyomotion.net/video/abc/iphone/7654321.mp4?md5=test',
      statusCode: 301,
    } as chrome.webRequest.WebRedirectionResponseDetails);

    headersListener?.({
      tabId: hdTabId,
      url: 'https://www47.tokyomotion.net/video/abc/iphone/7654321.mp4?md5=test',
      statusCode: 206,
      responseHeaders: [
        { name: 'content-type', value: 'video/mp4' },
        { name: 'content-range', value: 'bytes 0-4095/20000000' },
      ],
    } as chrome.webRequest.WebResponseHeadersDetails);

    const hdSnap = store.getSnapshot(hdTabId);
    expect(hdSnap.videos).toHaveLength(1);
    expect(hdSnap.videos[0]?.selectedUrl).toBe('https://www.tokyomotion.net/vsrc/hd/222222');

    // Stopping sniffer detaches webRequest listeners cleanly
    sniffer.stopSniffing();
    expect(sniffer.isSniffing()).toBe(false);
    expect(redirectListener).toBeUndefined();
    expect(headersListener).toBeUndefined();

    // Verify Referer / requestDomains helper scopes subdomains cleanly
    expect(extractRequestDomainScope('https://www47.tokyomotion.net/video/1234567.mp4')).toBe(
      'tokyomotion.net',
    );
    expect(extractRequestDomainScope('https://media.example.co.jp/watch/1')).toBe('example.co.jp');
    expect(parseHttpRefererAndOrigin('https://www.tokyomotion.net/video/1234567/a')).toEqual({
      referer: 'https://www.tokyomotion.net/video/1234567/a',
      origin: 'https://www.tokyomotion.net',
    });
  });

  it('automatically integrates Pattern 1 resolution variants into one VideoItem and selects highest quality', () => {
    const tabId = 205;
    const groups: RawVideoCandidateGroup[] = [
      {
        occurrenceKey: 'el_1::link::https://cdn.example.com/videos/sample_720p.mp4',
        primaryUrl: 'https://cdn.example.com/videos/sample_720p.mp4',
        domOrder: 1,
        durationSec: null,
        variants: [
          {
            url: 'https://cdn.example.com/videos/sample_720p.mp4',
            role: 'link-target',
            source: 'link-href',
            descriptor: '720p',
            videoWidth: 1280,
            videoHeight: 720,
          },
        ],
      },
      {
        occurrenceKey: 'el_2::link::https://cdn.example.com/videos/sample_1080p.mp4',
        primaryUrl: 'https://cdn.example.com/videos/sample_1080p.mp4',
        domOrder: 2,
        durationSec: null,
        variants: [
          {
            url: 'https://cdn.example.com/videos/sample_1080p.mp4',
            role: 'link-target',
            source: 'link-href',
            descriptor: '1080p',
            videoWidth: 1920,
            videoHeight: 1080,
          },
        ],
      },
      {
        occurrenceKey: 'el_3::link::https://cdn.example.com/videos/sample_480p.mp4',
        primaryUrl: 'https://cdn.example.com/videos/sample_480p.mp4',
        domOrder: 3,
        durationSec: null,
        variants: [
          {
            url: 'https://cdn.example.com/videos/sample_480p.mp4',
            role: 'link-target',
            source: 'link-href',
            descriptor: '480p',
            videoWidth: 854,
            videoHeight: 480,
          },
        ],
      },
    ];

    store.mergeVideoCandidateGroups(tabId, 1, groups);

    const snap = store.getSnapshot(tabId);
    // Crucial check: all 3 resolution variants must merge into 1 single card!
    expect(snap.videos).toHaveLength(1);
    const video = snap.videos[0]!;
    expect(video.variants).toHaveLength(3);
    // Automatically selected URL MUST be the 1080p version!
    expect(video.selectedUrl).toBe('https://cdn.example.com/videos/sample_1080p.mp4');
  });
});

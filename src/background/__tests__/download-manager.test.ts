import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../download-manager';
import { sessionStore } from '../session-store';

describe('DownloadManager (Dual-Lane & Readiness Gate)', () => {
  let manager: DownloadManager;
  let nextDownloadId: number;
  let startedDownloads: Array<{ id: number; url: string; filename?: string }>;
  let runtimeMessages: unknown[];

  beforeEach(() => {
    nextDownloadId = 100;
    startedDownloads = [];
    runtimeMessages = [];
    const sessionData: Record<string, unknown> = {};

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        session: {
          get: vi.fn(async () => sessionData),
          set: vi.fn(async (items) => Object.assign(sessionData, items)),
          remove: vi.fn(async () => {}),
        },
      },
      downloads: {
        download: vi.fn(async (opts: { url: string; filename?: string }) => {
          const id = nextDownloadId++;
          startedDownloads.push({ id, url: opts.url, filename: opts.filename });
          return id;
        }),
        cancel: vi.fn(async () => {}),
        search: vi.fn(async () => []),
      },
      runtime: {
        sendMessage: vi.fn(async (msg: unknown) => {
          runtimeMessages.push(msg);
          return { ok: true };
        }),
      },
      tabs: {
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    };

    manager = new DownloadManager();
  });

  it('blocks non-ready video streams at Readiness Gate while allowing ready MP4 and images concurrently', async () => {
    const tabId = 501;
    sessionStore.resetSessionForNewPage(
      tabId,
      'https://media.example.com/gallery',
      'watching',
      'Gallery Page',
    );

    sessionStore.mergeCandidateGroups(tabId, 1, [
      {
        occurrenceKey: 'img_1',
        primaryUrl: 'https://media.example.com/photo1.jpg',
        domOrder: 1,
        variants: [
          {
            url: 'https://media.example.com/photo1.jpg',
            role: 'src',
            source: 'img',
            naturalWidth: 1000,
            naturalHeight: 800,
          },
        ],
      },
    ]);

    sessionStore.mergeVideoCandidateGroups(
      tabId,
      1,
      [
        {
          occurrenceKey: 'vid_ready',
          primaryUrl: 'https://media.example.com/clip.mp4',
          domOrder: 2,
          durationSec: 15,
          variants: [
            {
              url: 'https://media.example.com/clip.mp4',
              role: 'src',
              source: 'video-element',
              videoWidth: 1920,
              videoHeight: 1080,
            },
          ],
        },
        {
          occurrenceKey: 'vid_manifest',
          primaryUrl: 'https://media.example.com/stream.m3u8',
          domOrder: 3,
          durationSec: null,
          variants: [
            {
              url: 'https://media.example.com/stream.m3u8',
              role: 'network',
              source: 'network-resource',
              videoWidth: null,
              videoHeight: null,
            },
          ],
        },
      ],
      'https://media.example.com/gallery',
    );

    manager.enqueue(tabId, ['item_1', 'vid_1', 'vid_2']);

    // Flush microtasks so async startChromeDownload executes
    await new Promise((r) => setTimeout(r, 20));

    const snap = sessionStore.getSnapshot(tabId);
    // Manifest stream ('vid_2') is blocked cleanly at Readiness Gate without calling chrome.downloads
    expect(snap.downloads['vid_2']?.status).toBe('failed');
    expect(snap.downloads['vid_2']?.errorCode).toBe('READINESS_GATE_BLOCKED');

    // Ready image ('item_1') and ready video ('vid_1') both started in parallel lanes
    expect(snap.downloads['item_1']?.status).toBe('in_progress');
    expect(snap.downloads['vid_1']?.status).toBe('in_progress');
    expect(startedDownloads).toHaveLength(2);

    // Cancel active video download
    const canceled = await manager.cancelDownload(tabId, 'vid_1');
    expect(canceled).toBe(true);
    expect(sessionStore.getSnapshot(tabId).downloads['vid_1']?.status).toBe('canceled');
  });

  it('saves assembled HLS streams and revokes Side Panel ObjectURL upon completion', async () => {
    const tabId = 502;
    sessionStore.resetSessionForNewPage(
      tabId,
      'https://media.example.com/watch',
      'watching',
      'Stream Page',
    );

    const objectUrl = 'blob:chrome-extension://abcdef/assembled-123';
    await manager.saveAssembledStream({
      tabId,
      itemId: 'vid_1',
      objectUrl,
      sourceManifestUrl: 'https://cdn.example.com/vod/episode1.m3u8',
      containerExtension: '.ts',
      totalBytes: 12_345_678,
    });

    expect(startedDownloads).toHaveLength(1);
    expect(startedDownloads[0]?.url).toBe(objectUrl);
    expect(startedDownloads[0]?.filename).toBe('Stream Page/episode1.ts');

    const dlId = startedDownloads[0]!.id;
    manager.handleDownloadDelta({
      id: dlId,
      state: { current: 'complete', previous: 'in_progress' },
    });

    expect(sessionStore.getSnapshot(tabId).downloads['vid_1']?.status).toBe('completed');
    expect(runtimeMessages).toContainEqual({
      channel: 'WIC_BG_TO_PANEL_RPC',
      type: 'PANEL_REVOKE_OBJECT_URL',
      objectUrl,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../download-manager';
import { sessionStore } from '../session-store';
import { refererRuleManager } from '../referer-rules';

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

  it('holds image slots until Chrome reports completion and releases slots on failure/cancel', async () => {
    const tabId = 601;
    sessionStore.resetSessionForNewPage(tabId, 'https://example.com', 'watching');
    const epoch = sessionStore.getSession(tabId)!.scanEpoch;
    sessionStore.mergeCandidateGroups(tabId, epoch, Array.from({ length: 10 }, (_, i) => ({
      occurrenceKey: `img_${i}`, primaryUrl: `https://example.com/${i}.jpg`, domOrder: i,
      variants: [{ url: `https://example.com/${i}.jpg`, role: 'src', source: 'img', naturalWidth: 100, naturalHeight: 100 }],
    })));
    const ids = sessionStore.getSnapshot(tabId).items.map((item) => item.itemId);
    manager.enqueue(tabId, ids);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedDownloads).toHaveLength(3);
    manager.handleDownloadDelta({ id: startedDownloads[0]!.id, state: { current: 'complete' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedDownloads).toHaveLength(4);
    manager.handleDownloadDelta({ id: startedDownloads[1]!.id, state: { current: 'interrupted' },
      error: { current: 'NETWORK_FAILED' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedDownloads).toHaveLength(5);
    await manager.cancelDownload(tabId, ids[2]!);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedDownloads).toHaveLength(6);
    expect(Object.values(sessionStore.getSnapshot(tabId).downloads)
      .filter((download) => download.status === 'in_progress')).toHaveLength(3);
  });

  it('does not consume a slot permanently when the Downloads API rejects a start', async () => {
    const tabId = 602;
    sessionStore.resetSessionForNewPage(tabId, 'https://example.com', 'watching');
    sessionStore.mergeCandidateGroups(tabId, sessionStore.getSession(tabId)!.scanEpoch,
      Array.from({ length: 4 }, (_, i) => ({
        occurrenceKey: `img_${i}`, primaryUrl: `https://example.com/${i}.jpg`, domOrder: i,
        variants: [{ url: `https://example.com/${i}.jpg`, role: 'src', source: 'img', naturalWidth: 100, naturalHeight: 100 }],
      })));
    (chrome.downloads.download as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('start failed'));
    manager.enqueue(tabId, sessionStore.getSnapshot(tabId).items.map((item) => item.itemId));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(startedDownloads).toHaveLength(3);
    expect(Object.values(sessionStore.getSnapshot(tabId).downloads)
      .filter((download) => download.status === 'failed')).toHaveLength(1);
  });

  it('keeps video slots and Referer rules until completion, routes work to one panel, and polls only while viewed', async () => {
    vi.useFakeTimers();
    const acquire = vi.spyOn(refererRuleManager, 'acquireDownloadRule').mockResolvedValue();
    const release = vi.spyOn(refererRuleManager, 'releaseDownloadRule').mockResolvedValue();
    try {
      const tabId = 603;
      sessionStore.resetSessionForNewPage(tabId, 'https://example.com', 'watching');
      sessionStore.mergeVideoCandidateGroups(tabId, sessionStore.getSession(tabId)!.scanEpoch,
        Array.from({ length: 5 }, (_, i) => ({
          occurrenceKey: `vid_${i}`, primaryUrl: `https://cdn.example.com/clip${i}.mp4`, domOrder: i, durationSec: 10,
          variants: [{ url: `https://cdn.example.com/clip${i}.mp4`, role: 'src', source: 'video-element', videoWidth: 100, videoHeight: 100 }],
        })));
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(async (msg) => {
        runtimeMessages.push(msg);
        return { ok: true, data: { mode: 'direct_url_fallback', finalUrl: msg.url, totalBytes: 1000 } };
      });
      (chrome.downloads.search as ReturnType<typeof vi.fn>).mockResolvedValue([{ state: 'in_progress', bytesReceived: 1, totalBytes: 1000 }]);
      manager.enqueue(tabId, sessionStore.getSnapshot(tabId).videos.map((video) => video.itemId), 'panel-owner');
      await vi.advanceTimersByTimeAsync(0);
      expect(startedDownloads).toHaveLength(2);
      expect(runtimeMessages).toEqual(expect.arrayContaining([expect.objectContaining({ recipientPanelId: 'panel-owner' })]));
      expect(release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      expect(chrome.downloads.search).not.toHaveBeenCalled();
      manager.setProgressSubscribers(new Set([tabId]));
      await vi.advanceTimersByTimeAsync(500);
      expect(chrome.downloads.search).toHaveBeenCalledTimes(2);
      manager.setProgressSubscribers(new Set());
      await vi.advanceTimersByTimeAsync(2000);
      expect(chrome.downloads.search).toHaveBeenCalledTimes(2);
      manager.handleDownloadDelta({ id: startedDownloads[0]!.id, state: { current: 'complete' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(release).toHaveBeenCalledWith(expect.stringContaining(`${tabId}:`));
      expect(startedDownloads).toHaveLength(3);
    } finally {
      acquire.mockRestore(); release.mockRestore(); vi.clearAllTimers(); vi.useRealTimers();
    }
  });

  it('does not resurrect a completed download when index persistence finishes late', async () => {
    const tabId = 604;
    sessionStore.resetSessionForNewPage(tabId, 'https://example.com', 'watching');
    sessionStore.mergeCandidateGroups(tabId, sessionStore.getSession(tabId)!.scanEpoch, [{
      occurrenceKey: 'img', primaryUrl: 'https://example.com/one.jpg', domOrder: 1,
      variants: [{ url: 'https://example.com/one.jpg', role: 'src', source: 'img', naturalWidth: 100, naturalHeight: 100 }],
    }]);
    let finish!: () => void;
    (chrome.storage.session.set as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      new Promise<void>((resolve) => { finish = resolve; }));
    const itemId = sessionStore.getSnapshot(tabId).items[0]!.itemId;
    manager.enqueue(tabId, [itemId]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    manager.handleDownloadDelta({ id: startedDownloads[0]!.id, state: { current: 'complete' } });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sessionStore.getSnapshot(tabId).downloads[itemId]?.status).toBe('completed');
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

  it('streams Referer-protected HTTP video to ObjectURL with redirected filename and mid-stream cancel', async () => {
    const tabId = 503;
    const redirectedCdnUrl =
      'https://www47.tokyomotion.net/video/test-cdn-path/test-session/iphone/1234567.mp4?md5=test&expires=2000000000';
    const mintedObjectUrl = 'blob:chrome-extension://ext123/tmo-1234567';

    sessionStore.resetSessionForNewPage(
      tabId,
      'https://www.tokyomotion.net/video/1234567/sample',
      'watching',
      'Sample Video Title',
    );
    sessionStore.mergeVideoCandidateGroups(
      tabId,
      1,
      [
        {
          occurrenceKey: 'vid_tmo_1',
          primaryUrl: 'https://www.tokyomotion.net/vsrc/sd/test-sd-source',
          domOrder: 1,
          durationSec: 285.05,
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
        {
          occurrenceKey: 'vid_tmo_2',
          primaryUrl: 'https://www.tokyomotion.net/vsrc/sd/999999999',
          domOrder: 2,
          durationSec: 120,
          variants: [
            {
              url: 'https://www.tokyomotion.net/vsrc/sd/999999999',
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
      'https://www.tokyomotion.net/video/1234567/sample',
    );

    let resolveSecondStream: ((res: unknown) => void) | undefined;
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (msg: { type?: string; transferId?: string; itemId?: string }) => {
        runtimeMessages.push(msg);
        if (msg?.type === 'PANEL_FETCH_HTTP_VIDEO_TO_OBJECT_URL') {
          if (msg.itemId === 'vid_1') {
            manager.handleHttpFetchProgress(tabId, 'vid_1', msg.transferId!, 6_000_000, 13_364_887);
            return {
              ok: true,
              data: {
                mode: 'object_url',
                objectUrl: mintedObjectUrl,
                finalUrl: redirectedCdnUrl,
                mimeType: 'video/mp4',
                totalBytes: 13_364_887,
              },
            };
          }
          return new Promise((resolve) => {
            resolveSecondStream = resolve;
          });
        }
        return { ok: true };
      },
    );

    manager.enqueue(tabId, ['vid_1', 'vid_2']);
    await new Promise((r) => setTimeout(r, 25));

    // vid_1 resolved opaque /vsrc/sd/... into Sample Video Title/1234567.mp4 via minted ObjectURL
    expect(startedDownloads).toHaveLength(1);
    expect(startedDownloads[0]?.url).toBe(mintedObjectUrl);
    expect(startedDownloads[0]?.filename).toBe('Sample Video Title/1234567.mp4');

    // Complete vid_1 and verify ObjectURL revocation
    manager.handleDownloadDelta({
      id: startedDownloads[0]!.id,
      state: { current: 'complete', previous: 'in_progress' },
    });
    expect(sessionStore.getSnapshot(tabId).downloads['vid_1']?.status).toBe('completed');
    expect(runtimeMessages).toContainEqual({
      channel: 'WIC_BG_TO_PANEL_RPC',
      type: 'PANEL_REVOKE_OBJECT_URL',
      objectUrl: mintedObjectUrl,
    });

    // Cancel vid_2 mid-HTTP-stream -> sends PANEL_ABORT_HTTP_VIDEO_FETCH and marks canceled immediately
    const canceledMidStream = await manager.cancelDownload(tabId, 'vid_2');
    expect(canceledMidStream).toBe(true);
    expect(sessionStore.getSnapshot(tabId).downloads['vid_2']?.status).toBe('canceled');
    expect(
      runtimeMessages.some(
        (m) => (m as { type?: string }).type === 'PANEL_ABORT_HTTP_VIDEO_FETCH',
      ),
    ).toBe(true);

    resolveSecondStream?.({ ok: false, error: 'aborted', code: 'USER_CANCELED' });
    await new Promise((r) => setTimeout(r, 10));
    expect(startedDownloads).toHaveLength(1);
  });
});

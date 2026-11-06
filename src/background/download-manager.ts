import {
  BLOB_DOWNLOAD_MAX_BYTES,
  BUFFERED_VIDEO_MAX_BYTES,
  INLINE_VIDEO_BLOB_MAX_BYTES,
  MAX_CONCURRENT_DOWNLOADS,
  MAX_CONCURRENT_VIDEO_DOWNLOADS,
  STORAGE_KEYS,
  VIDEO_BLOB_MAX_BYTES,
} from '@shared/constants';
import {
  buildSafeDownloadFilename,
  buildSafeVideoDownloadFilename,
  extractFilenameForSort,
} from '@shared/filename-utils';
import type {
  BlobDataUrlResponse,
  HttpMediaFetchResponse,
  MessageResult,
  PanelInternalRequestMessage,
  VideoBlobPrepareResponse,
} from '@shared/messages';
import type {
  ActiveDownloadIndexEntry,
  DownloadErrorCategory,
  ItemDownloadState,
  MediaMode,
} from '@shared/types';
import { getActiveVideoVariant, inferVideoFormat } from '@shared/video-utils';
import { refererRuleManager } from './referer-rules';
import { sessionStore } from './session-store';

interface QueuedDownloadRequest {
  tabId: number;
  itemId: string;
  panelId?: string;
}

interface ActiveHttpTransfer {
  tabId: number;
  itemId: string;
  transferId: string;
  targetUrl: string;
  canceled: boolean;
}

interface PreparedHttpDownload {
  downloadableUrl: string;
  revokeObjectUrl?: string;
  refererRuleKey?: string;
  finalUrl?: string;
  contentDisposition?: string;
  mimeType?: string;
  totalBytes?: number;
}

const PROGRESS_POLL_INTERVAL_MS = 500;

function isVideoItemId(itemId: string): boolean {
  return itemId.startsWith('vid_');
}

export class DownloadManager {
  private imageQueue: QueuedDownloadRequest[] = [];
  private videoQueue: QueuedDownloadRequest[] = [];
  private activeImageCount = 0;
  private activeVideoCount = 0;
  private activeDownloads = new Map<number, ActiveDownloadIndexEntry>(); // downloadId -> Entry
  private activeHttpTransfers = new Map<string, ActiveHttpTransfer>(); // `${tabId}:${itemId}` -> Transfer
  private isProcessing = false;
  private progressPollTimer: ReturnType<typeof setInterval> | null = null;
  private progressSubscribers = new Set<number>();
  private progressPolling = false;
  private initPromise: Promise<void> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();

  init(): Promise<void> {
    this.initPromise ??= sessionStore.ensureHydrated().then(() => this.hydrateAndReconcile());
    return this.initPromise;
  }

  setProgressSubscribers(tabIds: Set<number>): void {
    this.progressSubscribers = new Set(tabIds);
    this.ensureProgressPolling();
  }

  private async hydrateAndReconcile(): Promise<void> {
    try {
      const stored = await chrome.storage.session.get(STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX);
      const entries = stored[STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX] as
        | Record<number, ActiveDownloadIndexEntry>
        | undefined;

      for (const [idStr, entry] of Object.entries(entries ?? {})) {
        const downloadId = Number(idStr);
        if (Number.isNaN(downloadId)) continue;

        this.activeDownloads.set(downloadId, entry);

        // Reconcile with Chrome Downloads API status
        try {
          const results = await chrome.downloads.search({ id: downloadId });
          const item = results[0];
          if (!item || item.state === 'complete') {
            this.handleDownloadComplete(downloadId, entry);
          } else if (item.state === 'interrupted') {
            this.handleDownloadInterrupted(downloadId, entry, item.error);
          } else if (entry.refererRuleKey) {
            await refererRuleManager.acquireDownloadRule(entry.refererRuleKey,
              sessionStore.getSession(entry.tabId)?.pageUrl, entry.targetUrl);
          }
        } catch {
          this.activeDownloads.delete(downloadId);
        }
      }

      if (entries) await this.persistActiveIndex();
      for (const tabId of sessionStore.getAllTrackedTabIds()) {
        const session = sessionStore.getSession(tabId)!;
        for (const download of session.downloads.values()) {
          const tracked = Array.from(this.activeDownloads.values()).some((entry) =>
            entry.tabId === tabId && entry.itemId === download.itemId);
          if (download.status === 'queued' && !tracked) {
            (isVideoItemId(download.itemId) ? this.videoQueue : this.imageQueue)
              .push({ tabId, itemId: download.itemId, panelId: download.panelId });
          } else if (['starting', 'in_progress'].includes(download.status) && !tracked) {
            sessionStore.updateDownloadState(tabId, { ...download, status: 'failed',
              errorCode: 'WORKER_RESTARTED', errorMessage: '保存処理が中断されました。再試行してください',
              retryable: true, updatedAt: Date.now() });
          }
        }
      }
      this.ensureProgressPolling();
      this.pumpQueue();
    } catch (err) {
      console.warn('[WIC] Failed to reconcile active downloads:', err);
    }
  }

  enqueue(tabId: number, itemIds: string[], panelId?: string): void {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    for (const itemId of itemIds) {
      const existing = session.downloads.get(itemId);
      if (
        existing &&
        (existing.status === 'queued' ||
          existing.status === 'starting' ||
          existing.status === 'in_progress')
      ) {
        continue; // Already queued or active
      }

      if (isVideoItemId(itemId)) {
        const video = session.videoById.get(itemId);
        if (!video) continue;

        const activeVariant = getActiveVideoVariant(video.variants, video.selectedUrl);
        // Enforce Readiness Gate before queuing
        if (!activeVariant || activeVariant.readiness !== 'ready') {
          sessionStore.updateDownloadState(tabId, {
            itemId,
            targetUrl: video.selectedUrl,
            status: 'failed',
            errorCode: 'READINESS_GATE_BLOCKED',
            errorCategory: 'auth_or_forbidden',
            errorMessage:
              activeVariant?.blockReason ||
              'この動画は直接ダウンロード条件を満たしていないため保存できません',
            retryable: false,
            updatedAt: Date.now(),
          });
          continue;
        }

        const state: ItemDownloadState = {
          panelId,
          itemId,
          targetUrl: video.selectedUrl,
          totalBytes: activeVariant.fileSizeBytes ?? undefined,
          status: 'queued',
          retryable: false,
          updatedAt: Date.now(),
        };
        sessionStore.updateDownloadState(tabId, state);
        this.videoQueue.push({ tabId, itemId, panelId });
      } else {
        const item = session.itemById.get(itemId);
        if (!item) continue;

        const state: ItemDownloadState = {
          panelId,
          itemId,
          targetUrl: item.selectedUrl,
          status: 'queued',
          retryable: false,
          updatedAt: Date.now(),
        };
        sessionStore.updateDownloadState(tabId, state);
        this.imageQueue.push({ tabId, itemId, panelId });
      }
    }

    this.pumpQueue();
  }

  async cancelDownload(tabId: number, itemId: string): Promise<boolean> {
    // 1. Remove if still waiting in either lane queue
    const removeQueued = (q: QueuedDownloadRequest[]) => {
      const idx = q.findIndex((r) => r.tabId === tabId && r.itemId === itemId);
      if (idx >= 0) {
        q.splice(idx, 1);
        return true;
      }
      return false;
    };

    const wasQueued = removeQueued(this.videoQueue) || removeQueued(this.imageQueue);
    const session = sessionStore.getSession(tabId);
    const currentDl = session?.downloads.get(itemId);

    if (wasQueued) {
      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl: currentDl?.targetUrl || '',
        status: 'canceled',
        errorMessage: 'キャンセルされました',
        retryable: false,
        updatedAt: Date.now(),
      });
      return true;
    }

    // 2. Cancel active Side Panel HTTP media stream if currently fetching
    const transferKey = `${tabId}:${itemId}`;
    const activeHttp = this.activeHttpTransfers.get(transferKey);
    if (activeHttp) {
      activeHttp.canceled = true;
      this.activeHttpTransfers.delete(transferKey);
      try {
        const abortRpc: PanelInternalRequestMessage = {
          channel: 'WIC_BG_TO_PANEL_RPC',
          type: 'PANEL_ABORT_HTTP_FETCH',
          transferId: activeHttp.transferId,
        };
        chrome.runtime.sendMessage(abortRpc).catch(() => {});
      } catch {}

      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl: activeHttp.targetUrl,
        status: 'canceled',
        errorMessage: 'キャンセルされました',
        retryable: false,
        updatedAt: Date.now(),
      });
      return true;
    }

    // 3. Cancel active Chrome download if in progress
    for (const [downloadId, entry] of this.activeDownloads.entries()) {
      if (entry.tabId === tabId && entry.itemId === itemId) {
        try {
          await chrome.downloads.cancel(downloadId);
        } catch {}
        this.cleanupObjectUrlIfNeeded(entry.revokeObjectUrl);
        if (entry.refererRuleKey) void refererRuleManager.releaseDownloadRule(entry.refererRuleKey);
        this.activeDownloads.delete(downloadId);
        await this.persistActiveIndex();

        sessionStore.updateDownloadState(tabId, {
          itemId,
          targetUrl: entry.targetUrl,
          downloadId,
          status: 'canceled',
          errorMessage: 'キャンセルされました',
          retryable: false,
          updatedAt: Date.now(),
        });
        this.ensureProgressPolling();
        this.pumpQueue();
        return true;
      }
    }

    return false;
  }

  handleHttpFetchProgress(
    tabId: number,
    itemId: string,
    transferId: string,
    bytesReceived: number,
    totalBytes?: number,
  ): void {
    const activeHttp = this.activeHttpTransfers.get(`${tabId}:${itemId}`);
    if (!activeHttp || activeHttp.transferId !== transferId || activeHttp.canceled) {
      return;
    }

    const session = sessionStore.getSession(tabId);
    const currentDl = session?.downloads.get(itemId);
    if (!currentDl) return;

    if (currentDl.status === 'starting') {
      sessionStore.updateDownloadState(tabId, {
        ...currentDl,
        status: 'in_progress',
        bytesReceived,
        totalBytes: totalBytes && totalBytes > 0 ? totalBytes : currentDl.totalBytes,
        updatedAt: Date.now(),
      });
      return;
    }

    if (currentDl.status === 'in_progress') {
      sessionStore.emitDownloadProgress(tabId, [
        {
          itemId,
          bytesReceived,
          totalBytes: totalBytes && totalBytes > 0 ? totalBytes : currentDl.totalBytes,
        },
      ]);
    }
  }

  retryFailed(tabId: number, itemIds?: string[], mediaMode?: MediaMode, panelId?: string): void {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    const targetIds = itemIds ?? Array.from(session.downloads.keys());
    const eligibleIds: string[] = [];

    for (const id of targetIds) {
      if (mediaMode === 'video' && !isVideoItemId(id)) continue;
      if (mediaMode === 'image' && isVideoItemId(id)) continue;

      const dl = session.downloads.get(id);
      if (dl && dl.status === 'failed' && dl.retryable) {
        eligibleIds.push(id);
      }
    }

    if (eligibleIds.length > 0) {
      this.enqueue(tabId, eligibleIds, panelId);
    }
  }

  async saveCapturedFrame(options: {
    tabId: number;
    dataUrl: string;
    sourceVideoUrl: string;
    timestampSec: number;
  }): Promise<boolean> {
    const { tabId, dataUrl, sourceVideoUrl, timestampSec } = options;
    const session = sessionStore.getSession(tabId);
    const rawBase = extractFilenameForSort(sourceVideoUrl) || 'video';
    const dotIdx = rawBase.lastIndexOf('.');
    const stem = dotIdx > 0 ? rawBase.slice(0, dotIdx) : rawBase;
    const mins = Math.floor(timestampSec / 60);
    const secs = Math.floor(timestampSec % 60);
    const timeTag = `${String(mins).padStart(2, '0')}m${String(secs).padStart(2, '0')}s`;

    const filename = buildSafeDownloadFilename({
      targetUrl: `https://frame.local/${encodeURIComponent(`${stem}_frame_${timeTag}.png`)}`,
      domain: session?.domain,
      pageTitle: session?.pageTitle ?? session?.domain ?? 'frames',
      pageUrl: session?.pageUrl,
      format: 'png',
    });

    try {
      await chrome.downloads.download({
        url: dataUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false,
      });
      return true;
    } catch (err) {
      console.warn('[WIC] Failed to save captured video frame:', err);
      return false;
    }
  }

  async saveAssembledStream(options: {
    tabId: number;
    itemId: string;
    objectUrl: string;
    sourceManifestUrl: string;
    containerExtension: '.mp4' | '.ts';
    totalBytes: number;
  }): Promise<boolean> {
    const { tabId, itemId, objectUrl, sourceManifestUrl, containerExtension, totalBytes } = options;
    const session = sessionStore.getSession(tabId);
    const indexMatch = /^vid_(\d+)$/.exec(itemId);
    const itemIndex = indexMatch?.[1] ? Number(indexMatch[1]) : 1;

    const filename = buildSafeVideoDownloadFilename({
      targetUrl: sourceManifestUrl,
      domain: session?.domain,
      pageTitle: session?.pageTitle ?? session?.domain ?? 'videos',
      pageUrl: session?.pageUrl,
      itemIndex,
      format: containerExtension === '.mp4' ? 'mp4' : 'unknown',
      overrideExtension: containerExtension,
    });

    await this.startChromeDownload({
      tabId,
      itemId,
      targetUrl: sourceManifestUrl,
      downloadableUrl: objectUrl,
      filename,
      totalBytes,
      revokeObjectUrl: objectUrl,
    });

    return true;
  }

  private pumpQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Lane 1: Image Queue (max 3 concurrent)
    const activeCount = (video: boolean) => Array.from(this.activeDownloads.values())
      .filter((entry) => isVideoItemId(entry.itemId) === video).length;
    while (this.activeImageCount + activeCount(false) < MAX_CONCURRENT_DOWNLOADS && this.imageQueue.length > 0) {
      const next = this.imageQueue.shift();
      if (!next) break;

      this.activeImageCount++;
      void this.executeImageDownload(next.tabId, next.itemId, next.panelId).catch((error) => {
        this.failPreparation(next, error);
      }).finally(() => {
        this.activeImageCount--;
        this.pumpQueue();
      });
    }

    // Lane 2: Video Queue (max 2 concurrent, completely isolated from Image Queue)
    while (this.activeVideoCount + activeCount(true) < MAX_CONCURRENT_VIDEO_DOWNLOADS && this.videoQueue.length > 0) {
      const next = this.videoQueue.shift();
      if (!next) break;

      this.activeVideoCount++;
      void this.executeVideoDownload(next.tabId, next.itemId, next.panelId).catch((error) => {
        this.failPreparation(next, error);
      }).finally(() => {
        this.activeVideoCount--;
        this.pumpQueue();
      });
    }

    this.isProcessing = false;
  }

  private failPreparation(request: QueuedDownloadRequest, error: unknown): void {
    const previous = sessionStore.getSession(request.tabId)?.downloads.get(request.itemId);
    if (!previous || previous.status === 'canceled') return;
    sessionStore.updateDownloadState(request.tabId, { ...previous, status: 'failed',
      errorCode: 'PREPARATION_FAILED', errorMessage: `保存の準備に失敗しました: ${String(error)}`,
      retryable: true, updatedAt: Date.now() });
  }

  private async executeImageDownload(tabId: number, itemId: string, panelId?: string): Promise<void> {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    const item = session.itemById.get(itemId);
    if (!item) { this.failPreparation({ tabId, itemId }, '元のページの画像候補が失効しました'); return; }

    const variant = item.variants.find((v) => v.url === item.selectedUrl) || item.variants[0];
    const targetUrl = item.selectedUrl;

    sessionStore.updateDownloadState(tabId, {
      itemId,
      targetUrl,
      status: 'starting',
      retryable: false,
      updatedAt: Date.now(),
    });

    let downloadableUrl = targetUrl;

    if (targetUrl.startsWith('blob:')) {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          channel: 'WIC_BG_TO_CONTENT',
          type: 'BG_FETCH_BLOB_AS_DATA_URL',
          blobUrl: targetUrl,
          maxBytes: BLOB_DOWNLOAD_MAX_BYTES,
        })) as MessageResult<BlobDataUrlResponse>;

        if (!response.ok) {
          throw new Error(response.error);
        }
        downloadableUrl = response.data.dataUrl;
      } catch (err) {
        sessionStore.updateDownloadState(tabId, {
          itemId,
          targetUrl,
          status: 'failed',
          errorCode: 'BLOB_UNREACHABLE',
          errorCategory: 'blob_unreachable',
          errorMessage: `blob URLの解決に失敗しました: ${String(err)}`,
          retryable: false,
          updatedAt: Date.now(),
        });
        return;
      }
    } else if (variant?.largeDataRefId) {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          channel: 'WIC_BG_TO_CONTENT',
          type: 'BG_RESOLVE_LARGE_DATA_URL',
          largeDataRefId: variant.largeDataRefId,
        })) as MessageResult<string>;

        if (!response.ok) {
          throw new Error(response.error);
        }
        downloadableUrl = response.data;
      } catch (err) {
        sessionStore.updateDownloadState(tabId, {
          itemId,
          targetUrl,
          status: 'failed',
          errorCode: 'DATA_URL_EXPIRED',
          errorCategory: 'blob_unreachable',
          errorMessage: `退避データURLの取得に失敗しました: ${String(err)}`,
          retryable: false,
          updatedAt: Date.now(),
        });
        return;
      }
    }

    let preparedHttp: PreparedHttpDownload | undefined;
    if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
      // Fetch with cookies and the page's Referer before saving the original image bytes.
      preparedHttp = await this.prepareHttpDownload({
        tabId, itemId, targetUrl, pageUrl: variant?.sourcePageUrl ?? session.pageUrl, panelId,
        mediaMode: 'image', maxBytes: BLOB_DOWNLOAD_MAX_BYTES,
      });
      if (!preparedHttp) return;
      downloadableUrl = preparedHttp.downloadableUrl;
    }

    const filename = buildSafeDownloadFilename({
      targetUrl,
      domain: session.domain,
      pageTitle: session.pageTitle ?? session.domain ?? 'images',
      pageUrl: session.pageUrl,
      format: variant?.format,
      mimeHint: preparedHttp?.mimeType,
    });

    await this.startChromeDownload({
      tabId,
      itemId,
      targetUrl,
      downloadableUrl,
      filename,
      totalBytes: preparedHttp?.totalBytes,
      revokeObjectUrl: preparedHttp?.revokeObjectUrl,
      refererRuleKey: preparedHttp?.refererRuleKey,
    });
  }

  private async executeVideoDownload(tabId: number, itemId: string, panelId?: string): Promise<void> {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    const video = session.videoById.get(itemId);
    if (!video) { this.failPreparation({ tabId, itemId }, '元のページの動画候補が失効しました'); return; }

    const variant = getActiveVideoVariant(video.variants, video.selectedUrl);
    const targetUrl = video.selectedUrl;

    if (!variant || variant.readiness !== 'ready') {
      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl,
        status: 'failed',
        errorCode: 'READINESS_GATE_BLOCKED',
        errorCategory: 'auth_or_forbidden',
        errorMessage: variant?.blockReason || 'ダウンロード開始条件を満たしていません',
        retryable: false,
        updatedAt: Date.now(),
      });
      return;
    }

    sessionStore.updateDownloadState(tabId, {
      itemId,
      targetUrl,
      totalBytes: variant.fileSizeBytes ?? undefined,
      status: 'starting',
      retryable: false,
      updatedAt: Date.now(),
    });

    let downloadableUrl = targetUrl;
    let resolvedFinalUrl: string | undefined;
    let resolvedContentDisposition: string | undefined;
    let resolvedMimeType: string | undefined;
    let resolvedByteLength: number | undefined = variant.fileSizeBytes ?? undefined;
    let revokeObjectUrl: string | undefined;
    let refererRuleKey: string | undefined;

    if (targetUrl.startsWith('blob:')) {
      const transferId = `vblob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          channel: 'WIC_BG_TO_CONTENT',
          type: 'BG_PREPARE_VIDEO_BLOB',
          blobUrl: targetUrl,
          transferId,
          inlineMaxBytes: INLINE_VIDEO_BLOB_MAX_BYTES,
          absoluteMaxBytes: VIDEO_BLOB_MAX_BYTES,
          recipientPanelId: panelId,
        })) as MessageResult<VideoBlobPrepareResponse>;

        if (!response.ok) {
          if (response.code === 'MSE_OR_EXPIRED_BLOB') {
            sessionStore.updateVideoMetadata(tabId, {
              url: targetUrl,
              isMseStream: true,
            });
          }
          throw new Error(response.error);
        }

        resolvedMimeType = response.data.mimeType;
        resolvedByteLength = response.data.byteLength;
        sessionStore.updateVideoMetadata(tabId, {
          url: targetUrl,
          fileSizeBytes: resolvedByteLength,
        });

        if (response.data.mode === 'inline_data_url') {
          downloadableUrl = response.data.dataUrl;
        } else {
          // Request Side Panel window context to assemble streamed chunks into an extension ObjectURL
          const rpcMsg: PanelInternalRequestMessage = {
            channel: 'WIC_BG_TO_PANEL_RPC',
            type: 'PANEL_CREATE_OBJECT_URL_FROM_TRANSFER',
          recipientPanelId: panelId,
            transferId,
          };
          const panelRes = (await chrome.runtime.sendMessage(rpcMsg)) as MessageResult<string>;
          if (!panelRes?.ok || !panelRes.data) {
            throw new Error(
              panelRes && !panelRes.ok
                ? panelRes.error
                : '大容量動画データのブリッジ変換に失敗しました（サイドパネルを開いた状態で実行してください）',
            );
          }
          downloadableUrl = panelRes.data;
          revokeObjectUrl = panelRes.data;
        }
      } catch (err) {
        sessionStore.updateDownloadState(tabId, {
          itemId,
          targetUrl,
          status: 'failed',
          errorCode: 'BLOB_UNREACHABLE',
          errorCategory: 'blob_unreachable',
          errorMessage: err instanceof Error ? err.message : String(err),
          retryable: false,
          updatedAt: Date.now(),
        });
        return;
      }
    } else if (variant.largeDataRefId) {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          channel: 'WIC_BG_TO_CONTENT',
          type: 'BG_RESOLVE_LARGE_DATA_URL',
          largeDataRefId: variant.largeDataRefId,
        })) as MessageResult<string>;

        if (!response.ok) {
          throw new Error(response.error);
        }
        downloadableUrl = response.data;
      } catch (err) {
        sessionStore.updateDownloadState(tabId, {
          itemId,
          targetUrl,
          status: 'failed',
          errorCode: 'DATA_URL_EXPIRED',
          errorCategory: 'blob_unreachable',
          errorMessage: `退避データURLの取得に失敗しました: ${String(err)}`,
          retryable: false,
          updatedAt: Date.now(),
        });
        return;
      }
    } else if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
      const preparedHttp = await this.prepareHttpDownload({
        tabId, itemId, targetUrl, pageUrl: session.pageUrl, panelId,
        mediaMode: 'video', maxBytes: BUFFERED_VIDEO_MAX_BYTES,
      });
      if (!preparedHttp) return;
      downloadableUrl = preparedHttp.downloadableUrl;
      revokeObjectUrl = preparedHttp.revokeObjectUrl;
      refererRuleKey = preparedHttp.refererRuleKey;
      resolvedFinalUrl = preparedHttp.finalUrl;
      resolvedContentDisposition = preparedHttp.contentDisposition;
      resolvedMimeType = preparedHttp.mimeType;
      if (preparedHttp.totalBytes && preparedHttp.totalBytes > 0) {
        resolvedByteLength = preparedHttp.totalBytes;
        sessionStore.updateVideoMetadata(tabId, {
          url: targetUrl,
          fileSizeBytes: resolvedByteLength,
        });
      }
    }

    const indexMatch = /^vid_(\d+)$/.exec(itemId);
    const itemIndex = indexMatch?.[1] ? Number(indexMatch[1]) : 1;
    const effectiveFormat =
      variant.format !== 'unknown'
        ? variant.format
        : inferVideoFormat(resolvedFinalUrl ?? targetUrl, resolvedMimeType);

    const filename = buildSafeVideoDownloadFilename({
      targetUrl,
      resolvedUrl: resolvedFinalUrl,
      contentDisposition: resolvedContentDisposition,
      domain: session.domain,
      pageTitle: session.pageTitle ?? session.domain ?? 'videos',
      pageUrl: session.pageUrl,
      itemIndex,
      format: effectiveFormat,
      mimeHint: resolvedMimeType,
    });

    await this.startChromeDownload({
      tabId,
      itemId,
      targetUrl,
      downloadableUrl,
      filename,
      totalBytes: resolvedByteLength,
      revokeObjectUrl,
      refererRuleKey,
    });
  }

  private async prepareHttpDownload(params: {
    tabId: number;
    itemId: string;
    targetUrl: string;
    pageUrl?: string;
    panelId?: string;
    mediaMode: MediaMode;
    maxBytes: number;
  }): Promise<PreparedHttpDownload | undefined> {
    const { tabId, itemId, targetUrl, pageUrl, panelId, mediaMode, maxBytes } = params;
    const transferKey = `${tabId}:${itemId}`;
    const transferId = `http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const transfer: ActiveHttpTransfer = { tabId, itemId, transferId, targetUrl, canceled: false };
    this.activeHttpTransfers.set(transferKey, transfer);
    let keepRefererRule = false;
    try {
      await refererRuleManager.acquireDownloadRule(transferKey, pageUrl, targetUrl);
      if (transfer.canceled) return;

      const rpcMsg: PanelInternalRequestMessage = {
        channel: 'WIC_BG_TO_PANEL_RPC',
        type: 'PANEL_FETCH_HTTP_MEDIA_TO_OBJECT_URL',
        mediaMode,
        recipientPanelId: panelId,
        tabId, itemId, transferId, url: targetUrl, maxBytes,
      };
      const response = (await chrome.runtime.sendMessage(rpcMsg)) as
        MessageResult<HttpMediaFetchResponse> | undefined;
      if (transfer.canceled) {
        if (response?.ok && response.data?.mode === 'object_url') {
          this.cleanupObjectUrlIfNeeded(response.data.objectUrl);
        }
        return;
      }
      if (response && !response.ok) {
        const classified = classifyHttpFetchError(response.code, response.error, mediaMode);
        sessionStore.updateDownloadState(tabId, {
          itemId, targetUrl,
          status: response.code === 'USER_CANCELED' ? 'canceled' : 'failed',
          errorCode: response.code ?? 'HTTP_FETCH_ERROR',
          ...classified,
          updatedAt: Date.now(),
        });
        return;
      }
      const data = response?.ok ? response.data : undefined;
      if (data?.mode === 'object_url') {
        return { ...data, downloadableUrl: data.objectUrl, revokeObjectUrl: data.objectUrl };
      }
      // Oversized files or an unavailable panel use Chrome's download path.
      keepRefererRule = true;
      return { ...data, downloadableUrl: data?.finalUrl || targetUrl, refererRuleKey: transferKey };
    } catch {
      if (transfer.canceled) return;
      keepRefererRule = true;
      return { downloadableUrl: targetUrl, refererRuleKey: transferKey };
    } finally {
      this.activeHttpTransfers.delete(transferKey);
      if (!keepRefererRule) await refererRuleManager.releaseDownloadRule(transferKey);
    }
  }

  private async startChromeDownload(params: {
    tabId: number;
    itemId: string;
    targetUrl: string;
    downloadableUrl: string;
    filename: string;
    totalBytes?: number;
    revokeObjectUrl?: string;
    refererRuleKey?: string;
  }): Promise<void> {
    const {
      tabId,
      itemId,
      targetUrl,
      downloadableUrl,
      filename,
      totalBytes,
      revokeObjectUrl,
      refererRuleKey,
    } = params;

    try {
      const downloadId = await chrome.downloads.download({
        url: downloadableUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false,
      });

      const entry: ActiveDownloadIndexEntry = {
        downloadId,
        tabId,
        itemId,
        targetUrl,
        startedAt: Date.now(),
        revokeObjectUrl,
        refererRuleKey,
      };

      this.activeDownloads.set(downloadId, entry);
      await this.persistActiveIndex();
      // Small/cached downloads can finish while the critical index write is pending.
      if (!this.activeDownloads.has(downloadId)) return;

      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl,
        downloadId,
        suggestedFilename: filename,
        bytesReceived: revokeObjectUrl && totalBytes ? totalBytes : 0,
        totalBytes,
        status: 'in_progress',
        retryable: false,
        updatedAt: Date.now(),
      });

      this.ensureProgressPolling();
    } catch (err) {
      this.cleanupObjectUrlIfNeeded(revokeObjectUrl);
      if (refererRuleKey) void refererRuleManager.releaseDownloadRule(refererRuleKey);
      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl,
        status: 'failed',
        errorCode: 'DOWNLOAD_API_ERROR',
        errorCategory: 'unknown',
        errorMessage: `ダウンロードの開始に失敗しました: ${String(err)}`,
        retryable: true,
        updatedAt: Date.now(),
      });
    }
  }

  handleDownloadDelta(delta: chrome.downloads.DownloadDelta): void {
    const entry = this.activeDownloads.get(delta.id);
    if (!entry) return;

    if (delta.state?.current === 'complete') {
      this.handleDownloadComplete(delta.id, entry);
      this.ensureProgressPolling();
      this.pumpQueue();
    } else if (delta.state?.current === 'interrupted') {
      this.handleDownloadInterrupted(delta.id, entry, delta.error?.current);
      this.ensureProgressPolling();
      this.pumpQueue();
    }
  }

  private handleDownloadComplete(
    downloadId: number,
    entry: ActiveDownloadIndexEntry,
  ): void {
    this.cleanupObjectUrlIfNeeded(entry.revokeObjectUrl);
    if (entry.refererRuleKey) void refererRuleManager.releaseDownloadRule(entry.refererRuleKey);
    this.activeDownloads.delete(downloadId);
    void this.persistActiveIndex();

    sessionStore.updateDownloadState(entry.tabId, {
      itemId: entry.itemId,
      targetUrl: entry.targetUrl,
      downloadId,
      status: 'completed',
      retryable: false,
      updatedAt: Date.now(),
    });
  }

  private handleDownloadInterrupted(
    downloadId: number,
    entry: ActiveDownloadIndexEntry,
    rawError?: string,
  ): void {
    this.cleanupObjectUrlIfNeeded(entry.revokeObjectUrl);
    if (entry.refererRuleKey) void refererRuleManager.releaseDownloadRule(entry.refererRuleKey);
    this.activeDownloads.delete(downloadId);
    void this.persistActiveIndex();

    const { status, errorCategory, errorMessage, retryable } = classifyInterruptReason(rawError);

    sessionStore.updateDownloadState(entry.tabId, {
      itemId: entry.itemId,
      targetUrl: entry.targetUrl,
      downloadId,
      status,
      errorCode: rawError,
      errorCategory,
      errorMessage,
      retryable,
      updatedAt: Date.now(),
    });
  }

  private cleanupObjectUrlIfNeeded(objectUrl?: string): void {
    if (!objectUrl) return;
    try {
      const rpcMsg: PanelInternalRequestMessage = {
        channel: 'WIC_BG_TO_PANEL_RPC',
        type: 'PANEL_REVOKE_OBJECT_URL',
        objectUrl,
      };
      chrome.runtime.sendMessage(rpcMsg).catch(() => {});
    } catch {}
  }

  private ensureProgressPolling(): void {
    let hasActiveVideo = false;
    for (const entry of this.activeDownloads.values()) {
      if (isVideoItemId(entry.itemId) && this.progressSubscribers.has(entry.tabId)) {
        hasActiveVideo = true;
        break;
      }
    }

    if (hasActiveVideo && this.progressPollTimer === null) {
      this.progressPollTimer = setInterval(() => {
        void this.pollVideoDownloadProgress();
      }, PROGRESS_POLL_INTERVAL_MS);
    } else if (!hasActiveVideo && this.progressPollTimer !== null) {
      clearInterval(this.progressPollTimer);
      this.progressPollTimer = null;
    }
  }

  private async pollVideoDownloadProgress(): Promise<void> {
    if (this.progressPolling) return;
    this.progressPolling = true;
    try {
      if (this.activeDownloads.size === 0) {
        this.ensureProgressPolling();
        return;
      }

      const updatesByTab = new Map<
        number,
        Array<{ itemId: string; bytesReceived: number; totalBytes?: number }>
      >();

      for (const [downloadId, entry] of this.activeDownloads.entries()) {
        if (!isVideoItemId(entry.itemId) || !this.progressSubscribers.has(entry.tabId)) continue;
        try {
          const items = await chrome.downloads.search({ id: downloadId });
          const dl = items[0];
          if (!dl) continue;
          if (dl.state === 'complete' || dl.state === 'interrupted') {
            this.handleDownloadDelta({
              id: downloadId, state: { current: dl.state },
              error: dl.error ? { current: dl.error } : undefined
            });
            continue;
          }

          let list = updatesByTab.get(entry.tabId);
          if (!list) {
            list = [];
            updatesByTab.set(entry.tabId, list);
          }
          list.push({
            itemId: entry.itemId,
            bytesReceived: dl.bytesReceived,
            totalBytes: dl.totalBytes > 0 ? dl.totalBytes : undefined,
          });
        } catch {
          // Ignore transient search error
        }
      }

      for (const [tabId, updates] of updatesByTab.entries()) {
        sessionStore.emitDownloadProgress(tabId, updates);
      }
    } finally {
      this.progressPolling = false;
    }
  }

  private async persistActiveIndex(): Promise<void> {
    this.persistQueue = this.persistQueue.catch(() => { }).then(async () => {
      const record = Object.fromEntries(this.activeDownloads);
      try {
        await chrome.storage.session.set({ [STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX]: record });
      } catch (err) {
        console.warn('[WIC] Failed to persist active download index:', err);
      }
    });
    await this.persistQueue;
  }
}

function classifyHttpFetchError(
  code?: string,
  rawMessage?: string,
  mediaMode: MediaMode = 'video',
): {
  errorCategory: DownloadErrorCategory;
  errorMessage: string;
  retryable: boolean;
} {
  const mediaLabel = mediaMode === 'image' ? '画像' : '動画';
  if (code === 'USER_CANCELED') {
    return { errorCategory: 'unknown', errorMessage: 'キャンセルされました', retryable: false };
  }
  if (code === 'HTTP_401' || code === 'HTTP_403' || code === 'HTML_RESPONSE') {
    return {
      errorCategory: 'auth_or_forbidden',
      errorMessage:
        code === 'HTML_RESPONSE'
          ? rawMessage || '認証ページが返されたため保存できませんでした（ページを再スキャンしてください）'
          : `アクセスが拒否されました (${rawMessage ?? code})。ページの有効期限切れ時は再スキャンをお試しください`,
      retryable: true,
    };
  }
  if (code === 'HTTP_404' || code === 'HTTP_410') {
    return {
      errorCategory: 'not_found',
      errorMessage: `${mediaLabel}URLが見つからないか期限切れです (${rawMessage ?? code})`,
      retryable: true,
    };
  }
  if (code === 'NETWORK_FAILED' || (code && /^HTTP_5\d\d$/.test(code))) {
    return {
      errorCategory: 'network_transient',
      errorMessage: `ネットワークまたはサーバー応答エラーが発生しました (${rawMessage ?? code})`,
      retryable: true,
    };
  }
  return {
    errorCategory: 'unknown',
    errorMessage: rawMessage || `${mediaLabel}データの取得に失敗しました (${code ?? 'UNKNOWN'})`,
    retryable: true,
  };
}

function classifyInterruptReason(reason?: string): {
  status: 'failed' | 'canceled';
  errorCategory?: DownloadErrorCategory;
  errorMessage: string;
  retryable: boolean;
} {
  switch (reason) {
    case 'USER_CANCELED':
    case 'USER_SHUTDOWN':
      return {
        status: 'canceled',
        errorMessage: 'ユーザーまたはブラウザによってキャンセルされました',
        retryable: false,
      };

    case 'NETWORK_FAILED':
    case 'NETWORK_TIMEOUT':
    case 'NETWORK_DISCONNECTED':
    case 'SERVER_DOWN':
    case 'SERVER_FAILED':
    case 'CRASH':
      return {
        status: 'failed',
        errorCategory: 'network_transient',
        errorMessage: '一時的なネットワーク障害が発生しました（再試行可能）',
        retryable: true,
      };

    case 'SERVER_BAD_CONTENT':
    case 'NETWORK_INVALID_REQUEST':
      return {
        status: 'failed',
        errorCategory: 'not_found',
        errorMessage: '404 または URL が無効・失効している可能性があります',
        retryable: true,
      };

    case 'SERVER_UNAUTHORIZED':
    case 'SERVER_FORBIDDEN':
    case 'SERVER_CERT_PROBLEM':
    case 'BLOCKED':
      return {
        status: 'failed',
        errorCategory: 'auth_or_forbidden',
        errorMessage: '認証またはアクセス権限が必要なため保存できませんでした',
        retryable: false,
      };

    case 'FILE_ACCESS_DENIED':
    case 'FILE_NO_SPACE':
    case 'FILE_NAME_TOO_LONG':
    case 'FILE_BLOCKED':
    case 'FILE_SECURITY_CHECK_FAILED':
    case 'FILE_TOO_LARGE':
      return {
        status: 'failed',
        errorCategory: 'file_system',
        errorMessage: '保存先ファイルへの書き込みまたはセキュリティ確認で失敗しました',
        retryable: true,
      };

    default:
      return {
        status: 'failed',
        errorCategory: 'unknown',
        errorMessage: `ダウンロードに失敗しました (コード: ${reason ?? 'UNKNOWN'})`,
        retryable: true,
      };
  }
}

export const downloadManager = new DownloadManager();

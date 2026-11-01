import {
  BLOB_DOWNLOAD_MAX_BYTES,
  MAX_CONCURRENT_DOWNLOADS,
  STORAGE_KEYS,
} from '@shared/constants';
import { buildSafeDownloadFilename } from '@shared/filename-utils';
import type {
  BlobDataUrlResponse,
  MessageResult,
} from '@shared/messages';
import type {
  ActiveDownloadIndexEntry,
  DownloadErrorCategory,
  ItemDownloadState,
} from '@shared/types';
import { sessionStore } from './session-store';

interface QueuedDownloadRequest {
  tabId: number;
  itemId: string;
}

export class DownloadManager {
  private queue: QueuedDownloadRequest[] = [];
  private activeCount = 0;
  private activeDownloads = new Map<number, ActiveDownloadIndexEntry>(); // downloadId -> Entry
  private isProcessing = false;

  async init(): Promise<void> {
    await this.hydrateAndReconcile();
  }

  private async hydrateAndReconcile(): Promise<void> {
    try {
      const stored = await chrome.storage.session.get(STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX);
      const entries = stored[STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX] as
        | Record<number, ActiveDownloadIndexEntry>
        | undefined;

      if (!entries) return;

      for (const [idStr, entry] of Object.entries(entries)) {
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
          }
        } catch {
          // Download record no longer accessible
          this.activeDownloads.delete(downloadId);
        }
      }

      await this.persistActiveIndex();
      this.pumpQueue();
    } catch (err) {
      console.warn('[WIC] Failed to reconcile active downloads:', err);
    }
  }

  enqueue(tabId: number, itemIds: string[]): void {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    for (const itemId of itemIds) {
      const item = session.itemById.get(itemId);
      if (!item) continue;

      const existing = session.downloads.get(itemId);
      if (existing && (existing.status === 'queued' || existing.status === 'starting' || existing.status === 'in_progress')) {
        continue; // Already active
      }

      const state: ItemDownloadState = {
        itemId,
        targetUrl: item.selectedUrl,
        status: 'queued',
        retryable: false,
        updatedAt: Date.now(),
      };
      sessionStore.updateDownloadState(tabId, state);
      this.queue.push({ tabId, itemId });
    }

    this.pumpQueue();
  }

  retryFailed(tabId: number, itemIds?: string[]): void {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    const targetIds = itemIds ?? Array.from(session.downloads.keys());
    const eligibleIds: string[] = [];

    for (const id of targetIds) {
      const dl = session.downloads.get(id);
      if (dl && dl.status === 'failed' && dl.retryable) {
        eligibleIds.push(id);
      }
    }

    if (eligibleIds.length > 0) {
      this.enqueue(tabId, eligibleIds);
    }
  }

  private pumpQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.activeCount < MAX_CONCURRENT_DOWNLOADS && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;

      this.activeCount++;
      void this.executeDownload(next.tabId, next.itemId).finally(() => {
        this.activeCount--;
        this.pumpQueue();
      });
    }

    this.isProcessing = false;
  }

  private async executeDownload(tabId: number, itemId: string): Promise<void> {
    const session = sessionStore.getSession(tabId);
    if (!session) return;

    const item = session.itemById.get(itemId);
    if (!item) return;

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

    // 1. Resolve blob: URLs via Content Script if needed
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
      // 2. Resolve evicted large data: URL
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

    // Generate safe filename with folder based on page title
    const filename = buildSafeDownloadFilename({
      targetUrl,
      domain: session.domain,
      pageTitle: session.pageTitle ?? session.domain ?? 'images',
      format: variant?.format,
    });

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
      };

      this.activeDownloads.set(downloadId, entry);
      await this.persistActiveIndex();

      sessionStore.updateDownloadState(tabId, {
        itemId,
        targetUrl,
        downloadId,
        suggestedFilename: filename,
        status: 'in_progress',
        retryable: false,
        updatedAt: Date.now(),
      });
    } catch (err) {
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
      this.pumpQueue();
    } else if (delta.state?.current === 'interrupted') {
      this.handleDownloadInterrupted(delta.id, entry, delta.error?.current);
      this.pumpQueue();
    }
  }

  private handleDownloadComplete(
    downloadId: number,
    entry: ActiveDownloadIndexEntry,
  ): void {
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

  private async persistActiveIndex(): Promise<void> {
    const record: Record<number, ActiveDownloadIndexEntry> = {};
    for (const [id, entry] of this.activeDownloads) {
      record[id] = entry;
    }
    try {
      await chrome.storage.session.set({
        [STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX]: record,
      });
    } catch (err) {
      console.warn('[WIC] Failed to persist active download index:', err);
    }
  }
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

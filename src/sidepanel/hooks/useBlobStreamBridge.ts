import { useEffect } from 'react';
import { BLOB_STREAM_CHUNK_BYTES, PORT_NAMES, VIDEO_BLOB_MAX_BYTES } from '@shared/constants';
import {
  isBgToPanelRpc,
  type BlobStreamPortMessage,
  type HttpVideoFetchResponse,
  type MessageResult,
  type PanelToBackgroundMessage,
} from '@shared/messages';
import { inferVideoFormat, parseContentRangeTotalBytes } from '@shared/video-utils';
import { PANEL_INSTANCE_ID } from '../panel-instance';

const HTTP_BLOB_SLICE_FLUSH_BYTES = 8 * 1024 * 1024; // 8 MB slices keep V8 heap flat
const PROGRESS_REPORT_THROTTLE_MS = 250;
const SW_KEEPALIVE_INTERVAL_MS = 5_000;

interface InFlightTransfer {
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  chunks: Blob[];
  completed: boolean;
  error?: string;
  waiters: Array<{
    resolve: (objectUrl: string) => void;
    reject: (err: Error) => void;
  }>;
  objectUrl?: string;
  createdAt: number;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const trackedPanelObjectUrls = new Map<string, (() => Promise<void>) | undefined>();

/**
 * Registers an ObjectURL created in Side Panel so Background can revoke it cleanly
 * via `PANEL_REVOKE_OBJECT_URL` as soon as `chrome.downloads` completes or cancels.
 */
export function registerSidePanelObjectUrl(objectUrl: string, dispose?: () => Promise<void>): void {
  trackedPanelObjectUrls.set(objectUrl, dispose);
}

export function releaseSidePanelObjectUrl(objectUrl: string): void {
  if (!trackedPanelObjectUrls.has(objectUrl)) return;
  const dispose = trackedPanelObjectUrls.get(objectUrl);
  trackedPanelObjectUrls.delete(objectUrl);
  URL.revokeObjectURL(objectUrl);
  void dispose?.().catch(() => {});
}

/**
 * Zero-overhead receiver for >16MB video `blob:` streams inside Side Panel's `Window` scope.
 * Completely idle until the user clicks Download on a large page-origin `blob:` video.
 * Reconstructs chunks into a native `Blob`, mints `blob:chrome-extension://...` via `URL.createObjectURL`,
 * and revokes it immediately after Chrome finishes or cancels the download.
 */
export function useBlobStreamBridge(): void {
  useEffect(() => {
    const transfers = new Map<string, InFlightTransfer>();
    const activeHttpControllers = new Map<string, AbortController>();

    const reportHttpProgress = (
      tabId: number,
      itemId: string,
      transferId: string,
      bytesReceived: number,
      totalBytes?: number,
    ): void => {
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_REPORT_HTTP_FETCH_PROGRESS',
        tabId,
        itemId,
        transferId,
        bytesReceived,
        totalBytes,
      };
      try {
        chrome.runtime.sendMessage(msg).catch(() => {});
      } catch {}
    };

    const streamHttpVideoToObjectUrl = async (params: {
      tabId: number;
      itemId: string;
      transferId: string;
      url: string;
      maxBytes: number;
    }): Promise<MessageResult<HttpVideoFetchResponse>> => {
      const { tabId, itemId, transferId, url, maxBytes } = params;
      const controller = new AbortController();
      activeHttpControllers.set(transferId, controller);

      let bytesReceived = 0;
      let totalBytes: number | undefined;
      const keepaliveTimer = window.setInterval(() => {
        reportHttpProgress(tabId, itemId, transferId, bytesReceived, totalBytes);
      }, SW_KEEPALIVE_INTERVAL_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            ok: false,
            error: `HTTP ${response.status}`,
            code: `HTTP_${response.status}`,
          };
        }

        const rawContentType = response.headers.get('content-type') || '';
        const cleanMime = rawContentType.split(';')[0]?.trim().toLowerCase() || '';

        if (cleanMime === 'text/html' || cleanMime === 'application/xhtml+xml') {
          try {
            await response.body?.cancel();
          } catch {}
          return {
            ok: false,
            error: '動画データの代わりにHTMLページが返されました（認証または期限切れの可能性があります）',
            code: 'HTML_RESPONSE',
          };
        }

        const finalUrl = response.url || url;
        const contentDisposition = response.headers.get('content-disposition') || undefined;

        const rangeTotal = parseContentRangeTotalBytes(response.headers.get('content-range'));
        if (rangeTotal !== null) {
          totalBytes = rangeTotal;
        } else {
          const rawLen = response.headers.get('content-length');
          if (rawLen) {
            const parsedLen = Number(rawLen);
            if (Number.isFinite(parsedLen) && parsedLen > 0) {
              totalBytes = parsedLen;
            }
          }
        }

        if (totalBytes && totalBytes > maxBytes) {
          try {
            await response.body?.cancel();
          } catch {}
          return {
            ok: true,
            data: {
              mode: 'direct_url_fallback',
              finalUrl,
              mimeType: cleanMime || undefined,
              totalBytes,
              contentDisposition,
            },
          };
        }

        reportHttpProgress(tabId, itemId, transferId, 0, totalBytes);

        const inferredFmt = inferVideoFormat(finalUrl, cleanMime || undefined);
        const resolvedMime =
          cleanMime && cleanMime.startsWith('video/')
            ? cleanMime
            : inferredFmt === 'webm'
              ? 'video/webm'
              : inferredFmt === 'mov'
                ? 'video/quicktime'
                : 'video/mp4';

        if (!response.body) {
          const blob = await response.blob();
          const finalBlob = blob.type === resolvedMime ? blob : new Blob([blob], { type: resolvedMime });
          const objectUrl = URL.createObjectURL(finalBlob);
          registerSidePanelObjectUrl(objectUrl);
          reportHttpProgress(tabId, itemId, transferId, finalBlob.size, finalBlob.size);
          return {
            ok: true,
            data: {
              mode: 'object_url',
              objectUrl,
              finalUrl,
              mimeType: resolvedMime,
              totalBytes: finalBlob.size,
              contentDisposition,
            },
          };
        }

        const reader = response.body.getReader();
        let blobSlices: Blob[] = [];
        let pendingChunks: Uint8Array[] = [];
        let pendingSliceBytes = 0;
        let lastProgressAt = performance.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;

          bytesReceived += value.byteLength;
          if (bytesReceived > maxBytes) {
            try {
              await reader.cancel();
            } catch {}
            blobSlices = [];
            pendingChunks = [];
            return {
              ok: true,
              data: {
                mode: 'direct_url_fallback',
                finalUrl,
                mimeType: cleanMime || undefined,
                contentDisposition,
              },
            };
          }

          pendingChunks.push(value);
          pendingSliceBytes += value.byteLength;

          if (pendingSliceBytes >= HTTP_BLOB_SLICE_FLUSH_BYTES) {
            blobSlices.push(new Blob(pendingChunks as BlobPart[]));
            pendingChunks = [];
            pendingSliceBytes = 0;
          }

          const now = performance.now();
          if (now - lastProgressAt >= PROGRESS_REPORT_THROTTLE_MS) {
            lastProgressAt = now;
            reportHttpProgress(tabId, itemId, transferId, bytesReceived, totalBytes);
          }
        }

        if (pendingChunks.length > 0) {
          blobSlices.push(new Blob(pendingChunks as BlobPart[]));
          pendingChunks = [];
        }

        const finalBlob = new Blob(blobSlices, { type: resolvedMime });
        blobSlices = [];

        if (finalBlob.size === 0) {
          return {
            ok: false,
            error: '空の動画データ (0 bytes) が返されました',
            code: 'EMPTY_RESPONSE',
          };
        }

        const objectUrl = URL.createObjectURL(finalBlob);
        registerSidePanelObjectUrl(objectUrl);
        reportHttpProgress(tabId, itemId, transferId, finalBlob.size, finalBlob.size);

        return {
          ok: true,
          data: {
            mode: 'object_url',
            objectUrl,
            finalUrl,
            mimeType: resolvedMime,
            totalBytes: finalBlob.size,
            contentDisposition,
          },
        };
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return {
            ok: false,
            error: 'ユーザーによりキャンセルされました',
            code: 'USER_CANCELED',
          };
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: 'NETWORK_FAILED',
        };
      } finally {
        clearInterval(keepaliveTimer);
        activeHttpControllers.delete(transferId);
      }
    };

    const finalizeToObjectUrl = (transfer: InFlightTransfer): string => {
      if (transfer.objectUrl) return transfer.objectUrl;
      const reconstructed = new Blob(transfer.chunks as BlobPart[], { type: transfer.mimeType });
      // Release chunk array references immediately so GC can reclaim once Blob is backed
      transfer.chunks = [];
      const objectUrl = URL.createObjectURL(reconstructed);
      transfer.objectUrl = objectUrl;
      registerSidePanelObjectUrl(objectUrl);
      return objectUrl;
    };

    const handleConnect = (port: chrome.runtime.Port) => {
      if (port.name !== `${PORT_NAMES.BLOB_STREAM}:${PANEL_INSTANCE_ID}` && port.name !== PORT_NAMES.BLOB_STREAM) return;
      const transferIds = new Set<string>();
      const failTransfer = (transferId: string, error: string) => {
        const transfer = transfers.get(transferId);
        transfer?.waiters.forEach((waiter) => waiter.reject(new Error(error)));
        transfers.delete(transferId);
        port.postMessage({ type: 'BLOB_STREAM_ERROR', transferId, error } satisfies BlobStreamPortMessage);
      };

      port.onMessage.addListener((rawMsg: unknown) => {
        const msg = rawMsg as BlobStreamPortMessage | undefined;
        if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

        switch (msg.type) {
          case 'BLOB_STREAM_INIT': {
            if (transfers.size >= 2 || msg.totalBytes <= 0 || msg.totalBytes > VIDEO_BLOB_MAX_BYTES) {
              failTransfer(msg.transferId, '動画転送の容量または同時実行上限を超えています');
              return;
            }
            transfers.set(msg.transferId, {
              mimeType: msg.mimeType || 'video/mp4',
              totalBytes: msg.totalBytes,
              receivedBytes: 0,
              chunks: [],
              completed: false,
              waiters: [],
              createdAt: Date.now(),
            });
            transferIds.add(msg.transferId);
            port.postMessage({ type: 'BLOB_STREAM_ACK', transferId: msg.transferId, index: -1 } satisfies BlobStreamPortMessage);
            break;
          }

          case 'BLOB_STREAM_CHUNK': {
            const t = transfers.get(msg.transferId);
            if (!t || t.error) return;
            try {
              if (msg.index !== t.chunks.length || msg.base64Chunk.length > Math.ceil(BLOB_STREAM_CHUNK_BYTES / 3) * 4) {
                throw new Error('転送チャンクの順序またはサイズが不正です');
              }
              const bytes = base64ToUint8Array(msg.base64Chunk);
              if (t.receivedBytes + bytes.byteLength > t.totalBytes) throw new Error('転送サイズが上限を超えています');
              t.receivedBytes += bytes.byteLength;
              t.chunks.push(new Blob([bytes as Uint8Array<ArrayBuffer>]));
              port.postMessage({ type: 'BLOB_STREAM_ACK', transferId: msg.transferId, index: msg.index } satisfies BlobStreamPortMessage);
            } catch (err) {
              failTransfer(msg.transferId, `チャンクのデコードに失敗しました: ${String(err)}`);
            }
            break;
          }

          case 'BLOB_STREAM_COMPLETE': {
            const t = transfers.get(msg.transferId);
            if (!t) return;
            if (t.receivedBytes !== t.totalBytes) {
              failTransfer(msg.transferId, '動画データの転送が完了していません');
              return;
            }
            t.completed = true;
            port.postMessage({ type: 'BLOB_STREAM_ACK', transferId: msg.transferId, index: -2 } satisfies BlobStreamPortMessage);
            if (t.waiters.length > 0) {
              try {
                const url = finalizeToObjectUrl(t);
                for (const w of t.waiters) w.resolve(url);
              } catch (err) {
                for (const w of t.waiters) {
                  w.reject(err instanceof Error ? err : new Error(String(err)));
                }
              }
              t.waiters = [];
              transfers.delete(msg.transferId);
            }
            break;
          }

          case 'BLOB_STREAM_ERROR': {
            const t = transfers.get(msg.transferId);
            if (!t) return;
            t.error = msg.error;
            for (const w of t.waiters) {
              w.reject(new Error(msg.error));
            }
            t.waiters = [];
            transfers.delete(msg.transferId);
            break;
          }
        }
      });
      port.onDisconnect.addListener(() => {
        for (const id of transferIds) {
          const transfer = transfers.get(id);
          if (!transfer || transfer.completed) continue;
          transfer.waiters.forEach((waiter) => waiter.reject(new Error('動画の転送が中断されました')));
          transfers.delete(id);
        }
      });
    };

    const handleRpc = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean => {
      if (!isBgToPanelRpc(message)) return false;
      if (message.recipientPanelId && message.recipientPanelId !== PANEL_INSTANCE_ID) return false;

      if (message.type === 'PANEL_CREATE_OBJECT_URL_FROM_TRANSFER') {
        const t = transfers.get(message.transferId);
        if (!t) {
          sendResponse({
            ok: false,
            error: 'ストリーム転送セッションが見つかりません',
          });
          return false;
        }
        if (t.error) {
          transfers.delete(message.transferId);
          sendResponse({ ok: false, error: t.error });
          return false;
        }
        if (t.completed) {
          try {
            const url = finalizeToObjectUrl(t);
            transfers.delete(message.transferId);
            sendResponse({ ok: true, data: url });
          } catch (err) {
            transfers.delete(message.transferId);
            sendResponse({ ok: false, error: String(err) });
          }
          return false;
        }

        // Wait briefly if COMPLETE message is still in flight
        t.waiters.push({
          resolve: (url) => sendResponse({ ok: true, data: url }),
          reject: (err) => sendResponse({ ok: false, error: err.message }),
        });
        return true;
      }

      if (message.type === 'PANEL_FETCH_HTTP_VIDEO_TO_OBJECT_URL') {
        void streamHttpVideoToObjectUrl({
          tabId: message.tabId,
          itemId: message.itemId,
          transferId: message.transferId,
          url: message.url,
          maxBytes: message.maxBytes,
        }).then((result) => {
          sendResponse(result);
        });
        return true;
      }

      if (message.type === 'PANEL_ABORT_HTTP_VIDEO_FETCH') {
        const ctrl = activeHttpControllers.get(message.transferId);
        if (ctrl) {
          ctrl.abort();
          activeHttpControllers.delete(message.transferId);
        }
        sendResponse({ ok: true });
        return false;
      }

      if (message.type === 'PANEL_REVOKE_OBJECT_URL') {
        releaseSidePanelObjectUrl(message.objectUrl);
        sendResponse({ ok: true });
        return false;
      }

      return false;
    };

    try {
      chrome.runtime.onConnect.addListener(handleConnect);
      chrome.runtime.onMessage.addListener(handleRpc);
    } catch {}

    return () => {
      try {
        chrome.runtime.onConnect.removeListener(handleConnect);
        chrome.runtime.onMessage.removeListener(handleRpc);
      } catch {}
      for (const ctrl of activeHttpControllers.values()) {
        try {
          ctrl.abort();
        } catch {}
      }
      activeHttpControllers.clear();
      for (const url of trackedPanelObjectUrls.keys()) releaseSidePanelObjectUrl(url);
      transfers.clear();
    };
  }, []);
}

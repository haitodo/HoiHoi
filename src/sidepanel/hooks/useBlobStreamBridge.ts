import { useEffect } from 'react';
import { PORT_NAMES } from '@shared/constants';
import {
  isBgToPanelRpc,
  type BlobStreamPortMessage,
} from '@shared/messages';

interface InFlightTransfer {
  mimeType: string;
  totalBytes: number;
  chunks: Uint8Array[];
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

const trackedPanelObjectUrls = new Set<string>();

/**
 * Registers an ObjectURL created in Side Panel so Background can revoke it cleanly
 * via `PANEL_REVOKE_OBJECT_URL` as soon as `chrome.downloads` completes or cancels.
 */
export function registerSidePanelObjectUrl(objectUrl: string): void {
  trackedPanelObjectUrls.add(objectUrl);
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

    const finalizeToObjectUrl = (transfer: InFlightTransfer): string => {
      if (transfer.objectUrl) return transfer.objectUrl;
      const reconstructed = new Blob(transfer.chunks as BlobPart[], { type: transfer.mimeType });
      // Release chunk array references immediately so GC can reclaim once Blob is backed
      transfer.chunks = [];
      const objectUrl = URL.createObjectURL(reconstructed);
      transfer.objectUrl = objectUrl;
      trackedPanelObjectUrls.add(objectUrl);
      return objectUrl;
    };

    const handleConnect = (port: chrome.runtime.Port) => {
      if (port.name !== PORT_NAMES.BLOB_STREAM) return;

      port.onMessage.addListener((rawMsg: unknown) => {
        const msg = rawMsg as BlobStreamPortMessage | undefined;
        if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

        switch (msg.type) {
          case 'BLOB_STREAM_INIT': {
            transfers.set(msg.transferId, {
              mimeType: msg.mimeType || 'video/mp4',
              totalBytes: msg.totalBytes,
              chunks: [],
              completed: false,
              waiters: [],
              createdAt: Date.now(),
            });
            break;
          }

          case 'BLOB_STREAM_CHUNK': {
            const t = transfers.get(msg.transferId);
            if (!t || t.error) return;
            try {
              t.chunks[msg.index] = base64ToUint8Array(msg.base64Chunk);
            } catch (err) {
              t.error = `チャンクのデコードに失敗しました: ${String(err)}`;
            }
            break;
          }

          case 'BLOB_STREAM_COMPLETE': {
            const t = transfers.get(msg.transferId);
            if (!t) return;
            t.completed = true;
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
    };

    const handleRpc = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): boolean => {
      if (!isBgToPanelRpc(message)) return false;

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

      if (message.type === 'PANEL_REVOKE_OBJECT_URL') {
        if (trackedPanelObjectUrls.has(message.objectUrl)) {
          try {
            URL.revokeObjectURL(message.objectUrl);
          } catch {}
          trackedPanelObjectUrls.delete(message.objectUrl);
        }
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
      for (const url of trackedPanelObjectUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
      trackedPanelObjectUrls.clear();
      transfers.clear();
    };
  }, []);
}

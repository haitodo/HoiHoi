import { isBgToContentMessage } from '@shared/messages';
import { readBlobAsDataUrl } from './blob-reader';
import { createChunkRunner, type ChunkRunnerController } from './chunk-runner';

/**
 * Programmatically Injected Content Script (`dist/content/scanner.js`)
 *
 * CRITICAL INVARIANTS (`design.md` §4, Task C1–C3):
 * 1. Single IIFE bundle with no dynamic ESM imports.
 * 2. Guaranteed idempotent initialization guarded by `window.__WIC_SCANNER__`.
 * 3. Handles `BG_PING_CONTENT`, `BG_START_OR_RESCAN`, `BG_FETCH_BLOB_AS_DATA_URL`, and `BG_RESOLVE_LARGE_DATA_URL`.
 */

interface WicScannerController {
  startOrRescan(scanEpoch: number): void;
  getScanEpoch(): number;
  destroy(): void;
}

declare global {
  interface Window {
    __WIC_SCANNER__?: WicScannerController;
  }
}

function createScannerController(): WicScannerController {
  let currentScanEpoch = 0;
  const largeDataUrlStore = new Map<string, string>();

  const chunkRunner: ChunkRunnerController = createChunkRunner({
    largeDataUrlStore,
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isBgToContentMessage(message)) return false;

    switch (message.type) {
      case 'BG_PING_CONTENT': {
        sendResponse({
          ok: true,
          data: {
            alive: true,
            pageUrl: window.location.href,
            scanEpoch: currentScanEpoch,
          },
        });
        return false;
      }

      case 'BG_START_OR_RESCAN': {
        currentScanEpoch = message.scanEpoch;
        chunkRunner.startOrRescan(currentScanEpoch);
        sendResponse({ ok: true });
        return false;
      }

      case 'BG_FETCH_BLOB_AS_DATA_URL': {
        // Asynchronous resolution inside page origin
        readBlobAsDataUrl(message.blobUrl, message.maxBytes)
          .then((res) => {
            sendResponse({ ok: true, data: res });
          })
          .catch((err: unknown) => {
            sendResponse({ ok: false, error: String(err), code: 'BLOB_FETCH_FAILED' });
          });
        return true; // Keep channel open for async sendResponse
      }

      case 'BG_RESOLVE_LARGE_DATA_URL': {
        const fullDataUrl = largeDataUrlStore.get(message.largeDataRefId);
        if (!fullDataUrl) {
          sendResponse({
            ok: false,
            error: 'Large data URL reference expired or not found in page memory',
            code: 'NOT_FOUND',
          });
        } else {
          sendResponse({ ok: true, data: fullDataUrl });
        }
        return false;
      }
    }
  });

  return {
    startOrRescan(scanEpoch: number) {
      currentScanEpoch = scanEpoch;
      chunkRunner.startOrRescan(scanEpoch);
    },
    getScanEpoch() {
      return currentScanEpoch;
    },
    destroy() {
      chunkRunner.destroy();
    },
  };
}

if (!window.__WIC_SCANNER__) {
  window.__WIC_SCANNER__ = createScannerController();
}

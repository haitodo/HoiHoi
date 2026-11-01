import { isBgToContentMessage } from '@shared/messages';
import { readBlobAsDataUrl } from './blob-reader';
import { createChunkRunner, type ChunkRunnerController } from './chunk-runner';

/**
 * Robust Content Script (`dist/content/scanner.js`)
 * Runs directly on webpages (via manifest content_scripts + dynamic fallback).
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

function isExtensionContextValid(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function createScannerController(): WicScannerController {
  let currentScanEpoch = 1;
  const largeDataUrlStore = new Map<string, string>();

  const chunkRunner: ChunkRunnerController = createChunkRunner({
    largeDataUrlStore,
  });

  // Listen for background commands
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtensionContextValid()) {
      chunkRunner.destroy();
      return false;
    }

    if (!isBgToContentMessage(message)) return false;

    switch (message.type) {
      case 'BG_PING_CONTENT': {
        sendResponse({
          ok: true,
          data: {
            alive: true,
            pageUrl: window.location.href,
            pageTitle: document.title || undefined,
            scanEpoch: currentScanEpoch,
          },
        });
        return false;
      }

      case 'BG_START_OR_RESCAN': {
        currentScanEpoch = message.scanEpoch || currentScanEpoch + 1;
        console.log(`[WIC Content] Received BG_START_OR_RESCAN for epoch ${currentScanEpoch}`);
        chunkRunner.startOrRescan(currentScanEpoch);
        sendResponse({ ok: true });
        return false;
      }

      case 'BG_FETCH_BLOB_AS_DATA_URL': {
        readBlobAsDataUrl(message.blobUrl, message.maxBytes)
          .then((res) => {
            sendResponse({ ok: true, data: res });
          })
          .catch((err: unknown) => {
            sendResponse({ ok: false, error: String(err), code: 'BLOB_FETCH_FAILED' });
          });
        return true;
      }

      case 'BG_RESOLVE_LARGE_DATA_URL': {
        const fullDataUrl = largeDataUrlStore.get(message.largeDataRefId);
        if (!fullDataUrl) {
          sendResponse({
            ok: false,
            error: 'Large data URL reference expired or not found',
            code: 'NOT_FOUND',
          });
        } else {
          sendResponse({ ok: true, data: fullDataUrl });
        }
        return false;
      }
    }
  });

  // Automatically start an initial scan once DOM is ready so images are discovered proactively
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isExtensionContextValid()) {
        chunkRunner.startOrRescan(currentScanEpoch);
      }
    });
  } else {
    // DOM already ready, scan immediately
    setTimeout(() => {
      if (isExtensionContextValid()) {
        chunkRunner.startOrRescan(currentScanEpoch);
      }
    }, 100);
  }

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

// Clean up any lingering previous controller if extension was re-injected
if (window.__WIC_SCANNER__) {
  try {
    window.__WIC_SCANNER__.destroy();
  } catch {}
}

console.log('[WIC Content] Initializing content script on:', window.location.href);
window.__WIC_SCANNER__ = createScannerController();

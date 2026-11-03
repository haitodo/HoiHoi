import { isBgToContentMessage } from '@shared/messages';
import {
  fetchTextOnDemand,
  prepareOrStreamVideoBlob,
  readBlobAsDataUrl,
} from './blob-reader';
import { createChunkRunner, type ChunkRunnerController } from './chunk-runner';
import { PORT_NAMES } from '@shared/constants';
import type { ScannerWatchMessage } from '@shared/messages';
import { LargeDataStore } from './large-data-store';
import { createScanToolsController } from './scan-tools';

/**
 * Robust Content Script (`dist/content/scanner.js`)
 * Runs directly on webpages (via dynamic injection + singleton guard).
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
  const largeDataUrlStore = new LargeDataStore();
  const scanTools = createScanToolsController({ getEpoch: () => currentScanEpoch, largeDataUrlStore });
  const viewers = new Set<chrome.runtime.Port>();
  let runningEpoch: number | null = null;
  let replayRequired = false;

  const startIfWatched = () => {
    if (viewers.size === 0 || runningEpoch === currentScanEpoch) return;
    runningEpoch = currentScanEpoch;
    chunkRunner.startOrRescan(currentScanEpoch, replayRequired);
    replayRequired = false;
  };

  const chunkRunner: ChunkRunnerController = createChunkRunner({
    largeDataUrlStore,
  });

  // Listen for background commands
  const onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: unknown, _sender, sendResponse) => {
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
        scanTools.stop();
        currentScanEpoch = message.scanEpoch || currentScanEpoch + 1;
        replayRequired = true;
        runningEpoch = null;
        startIfWatched();
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

      case 'BG_PREPARE_VIDEO_BLOB': {
        prepareOrStreamVideoBlob({
          blobUrl: message.blobUrl,
          transferId: message.transferId,
          inlineMaxBytes: message.inlineMaxBytes,
          absoluteMaxBytes: message.absoluteMaxBytes,
          recipientPanelId: message.recipientPanelId,
        })
          .then((res) => {
            sendResponse({ ok: true, data: res });
          })
          .catch((err: unknown) => {
            const code =
              (err as { code?: string })?.code ?? 'VIDEO_BLOB_PREPARE_FAILED';
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              code,
            });
          });
        return true;
      }

      case 'BG_FETCH_TEXT_ON_DEMAND': {
        fetchTextOnDemand(message.url, message.maxChars)
          .then((text) => {
            sendResponse({ ok: true, data: text });
          })
          .catch((err: unknown) => {
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              code: 'MANIFEST_FETCH_FAILED',
            });
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

      case 'BG_STOP_SCANNER': {
        if (viewers.size === 0) {
          scanTools.stop();
          chunkRunner.destroy(Boolean(message.releaseData));
          runningEpoch = null;
          if (message.releaseData) largeDataUrlStore.clear();
        }
        sendResponse({ ok: true });
        return false;
      }
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name === PORT_NAMES.SCAN_TOOLS) { scanTools.attach(port); return; }
    if (port.name !== PORT_NAMES.SCANNER_LIFECYCLE) return;
    port.onMessage.addListener((message: ScannerWatchMessage) => {
      if (message?.type !== 'SCANNER_WATCH' || !Number.isInteger(message.scanEpoch)) return;
      viewers.add(port);
      currentScanEpoch = Math.max(currentScanEpoch, message.scanEpoch);
      startIfWatched();
    });
    port.onDisconnect.addListener(() => {
      viewers.delete(port);
      if (viewers.size === 0) {
        scanTools.stop();
        chunkRunner.destroy();
        runningEpoch = null;
      }
    });
  };
  chrome.runtime.onConnect.addListener(onConnect);

  return {
    startOrRescan(scanEpoch: number) {
      currentScanEpoch = scanEpoch;
      startIfWatched();
    },
    getScanEpoch() {
      return currentScanEpoch;
    },
    destroy() {
      scanTools.stop();
      chunkRunner.destroy(true);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.runtime.onConnect.removeListener(onConnect);
      for (const port of viewers) port.disconnect();
      viewers.clear();
      largeDataUrlStore.clear();
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

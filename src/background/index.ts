import { PORT_NAMES } from '@shared/constants';
import {
  isContentToBgMessage,
  isPanelToBgMessage,
  type BackgroundToPanelEvent,
  type MessageResult,
} from '@shared/messages';
import { downloadManager } from './download-manager';
import { sessionStore } from './session-store';
import {
  bootstrapTabScan,
  handleTabNavigation,
  stopAllScanners,
  triggerTabRescan,
} from './tab-coordinator';

/**
 * Background Service Worker Entrypoint (Manifest V3)
 *
 * CRITICAL INVARIANTS (`design.md` §2, §3, §5):
 * 1. Register ALL chrome.* event listeners synchronously at top-level.
 * 2. Keep openPanelOnActionClick: false so chrome.action.onClicked fires and grants activeTab.
 * 3. Call chrome.sidePanel.open({ tabId }) synchronously before any await in action.onClicked.
 * 4. Forward session events to open Side Panel pages via chrome.runtime.sendMessage.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void downloadManager.init();
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;

  // MUST stay synchronous (no await above this line) to preserve user gesture
  const openPanelPromise = chrome.sidePanel.open({ tabId: tab.id });

  void bootstrapTabScan(tab, openPanelPromise);

  // Notify Side Panel of user-initiated action click on this tab
  try {
    chrome.runtime
      .sendMessage({
        channel: 'WIC_BG_TO_PANEL',
        type: 'EVENT_ACTION_CLICKED',
        tabId: tab.id,
        windowId: tab.windowId,
      })
      .catch(() => {});
  } catch {}
});

// Connect port listener to track Side Panel lifecycle
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAMES.SIDEPANEL_LIFECYCLE) {
    port.onDisconnect.addListener(() => {
      // Side Panel closed -> stop observers across tracked tabs to eliminate idle load
      void stopAllScanners();
    });
  }
});

// Broadcast session events to any open extension views (Side Panel)
sessionStore.onEvent((event: BackgroundToPanelEvent) => {
  try {
    chrome.runtime.sendMessage(event).catch(() => {
      // Side Panel might be closed or switching tabs; safe to ignore
    });
  } catch {}
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isContentToBgMessage(message)) {
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      sendResponse({ ok: false, error: 'Unknown sender tab' });
      return false;
    }

    void (async () => {
      try {
        await sessionStore.ensureHydrated();

        switch (message.type) {
          case 'CONTENT_SCAN_BATCH': {
            if (message.groups.length > 0) {
              sessionStore.mergeCandidateGroups(
                tabId,
                message.scanEpoch,
                message.groups,
                message.pageTitle,
              );
            }
            if (message.videoGroups && message.videoGroups.length > 0) {
              sessionStore.mergeVideoCandidateGroups(
                tabId,
                message.scanEpoch,
                message.videoGroups,
                message.pageUrl,
                message.pageTitle,
              );
            }
            sendResponse({ ok: true });
            break;
          }
          case 'CONTENT_SCAN_STATUS': {
            if (message.pageTitle) {
              sessionStore.updatePageTitle(tabId, message.pageTitle);
            }
            sessionStore.setScanStatus(tabId, message.status);
            sendResponse({ ok: true });
            break;
          }
          case 'CONTENT_IMAGE_LOADED_DIMENSIONS': {
            sessionStore.updateItemDimensions(
              tabId,
              message.url,
              message.naturalWidth,
              message.naturalHeight,
            );
            sendResponse({ ok: true });
            break;
          }
          case 'CONTENT_VIDEO_METADATA_LOADED': {
            sessionStore.updateVideoMetadata(tabId, {
              url: message.url,
              videoWidth: message.videoWidth,
              videoHeight: message.videoHeight,
              durationSec: message.durationSec,
              isLive: message.isLive,
              posterUrl: message.posterUrl,
              isDrmProtected: message.isDrmProtected,
            });
            sendResponse({ ok: true });
            break;
          }
        }
      } catch (err) {
        console.error('[WIC BG] Error handling content message:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true; // Keep channel open for async response
  }

  if (isPanelToBgMessage(message)) {
    void (async () => {
      try {
        await sessionStore.ensureHydrated();
        let tabId = message.tabId;

        // Fallback: If tabId is invalid or <= 0, query active tab directly from Background
        if (!tabId || tabId <= 0) {
          try {
            const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (activeTab?.id !== undefined) {
              tabId = activeTab.id;
            }
          } catch {}
        }

        switch (message.type) {
          case 'PANEL_GET_TAB_SESSION': {
            let snapshot = sessionStore.getSnapshot(tabId);
            if (snapshot.scanStatus === 'unscanned' && !snapshot.pageUrl && tabId > 0) {
              try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.url) {
                  sessionStore.getOrCreateSession(tabId, tab.url);
                  snapshot = sessionStore.getSnapshot(tabId);
                }
              } catch {}
            }
            sendResponse({ ok: true, data: snapshot });
            break;
          }

          case 'PANEL_TRIGGER_RESCAN': {
            const ok = await triggerTabRescan(tabId);
            sendResponse({ ok });
            break;
          }

          case 'PANEL_UPDATE_SELECTION': {
            const updatedIds = sessionStore.updateSelection(
              tabId,
              message.mutation,
              message.mediaMode,
            );
            sendResponse({ ok: true, data: updatedIds });
            break;
          }

          case 'PANEL_SELECT_VARIANT': {
            const ok = sessionStore.selectVariant(tabId, message.itemId, message.variantUrl);
            sendResponse({ ok });
            break;
          }

          case 'PANEL_BATCH_SELECT_VARIANTS': {
            const ok = sessionStore.batchSelectVariants(
              tabId,
              message.target,
              message.itemIds,
              message.mediaMode,
            );
            sendResponse({ ok });
            break;
          }

          case 'PANEL_REPORT_THUMB_DIMENSIONS': {
            sessionStore.updateItemDimensions(
              tabId,
              message.variantUrl,
              message.naturalWidth,
              message.naturalHeight,
            );
            sendResponse({ ok: true });
            break;
          }

          case 'PANEL_REPORT_VIDEO_METADATA': {
            sessionStore.updateVideoMetadata(tabId, {
              url: message.variantUrl,
              videoWidth: message.videoWidth,
              videoHeight: message.videoHeight,
              durationSec: message.durationSec,
            });
            sendResponse({ ok: true });
            break;
          }

          case 'PANEL_RESOLVE_HLS_MANIFEST': {
            let manifestText: string | null = null;
            // 1. Try page context first so cookies/origin headers match
            try {
              const csRes = (await chrome.tabs.sendMessage(tabId, {
                channel: 'WIC_BG_TO_CONTENT',
                type: 'BG_FETCH_TEXT_ON_DEMAND',
                url: message.manifestUrl,
                maxChars: 512_000,
              })) as MessageResult<string>;
              if (csRes?.ok && csRes.data) {
                manifestText = csRes.data;
              }
            } catch {}

            // 2. Fallback to extension fetch if cross-origin CDN blocked page CORS
            if (!manifestText) {
              const resp = await fetch(message.manifestUrl);
              if (!resp.ok) {
                sendResponse({
                  ok: false,
                  error: `プレイリストの取得に失敗しました (HTTP ${resp.status})`,
                });
                break;
              }
              manifestText = (await resp.text()).slice(0, 512_000);
            }

            const result = sessionStore.applyParsedHlsManifest(
              tabId,
              message.itemId,
              message.manifestUrl,
              manifestText,
            );
            sendResponse({ ok: true, data: result });
            break;
          }

          case 'PANEL_ENQUEUE_DOWNLOADS': {
            downloadManager.enqueue(tabId, message.itemIds);
            sendResponse({ ok: true });
            break;
          }

          case 'PANEL_CANCEL_DOWNLOAD': {
            const ok = await downloadManager.cancelDownload(tabId, message.itemId);
            sendResponse({ ok });
            break;
          }

          case 'PANEL_SAVE_CAPTURED_FRAME': {
            const ok = await downloadManager.saveCapturedFrame({
              tabId,
              dataUrl: message.dataUrl,
              sourceVideoUrl: message.sourceVideoUrl,
              timestampSec: message.timestampSec,
            });
            sendResponse({ ok });
            break;
          }

          case 'PANEL_SAVE_ASSEMBLED_STREAM': {
            const ok = await downloadManager.saveAssembledStream({
              tabId,
              itemId: message.itemId,
              objectUrl: message.objectUrl,
              sourceManifestUrl: message.sourceManifestUrl,
              containerExtension: message.containerExtension,
              totalBytes: message.totalBytes,
            });
            sendResponse({ ok });
            break;
          }

          case 'PANEL_RETRY_FAILED_DOWNLOADS': {
            downloadManager.retryFailed(tabId, message.itemIds, message.mediaMode);
            sendResponse({ ok: true });
            break;
          }
        }
      } catch (err) {
        console.error('[WIC BG] Error handling panel message:', err);
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true; // Keep channel open for async response
  }

  return false;
});

chrome.downloads.onChanged.addListener((delta) => {
  downloadManager.handleDownloadDelta(delta);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    handleTabNavigation(tabId);
  } else if (changeInfo.title) {
    sessionStore.updatePageTitle(tabId, changeInfo.title);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStore.removeTab(tabId);
});

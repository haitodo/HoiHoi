import { CONTENT_SCANNER_SCRIPT_PATH } from '@shared/constants';
import type { MessageResult } from '@shared/messages';
import { sessionStore } from './session-store';

export async function bootstrapTabScan(
  tab: chrome.tabs.Tab,
  openPanelPromise: Promise<void>,
): Promise<void> {
  await openPanelPromise.catch((err: unknown) => {
    console.error('[WIC] Failed to open Side Panel:', err);
  });

  const tabId = tab.id;
  if (tabId === undefined) return;

  await sessionStore.ensureHydrated();

  const url = tab.url || '';
  if (!isScannableUrl(url)) {
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      'このページ（ブラウザ保護ページ・拡張機能管理画面など）ではスキャンできません',
    );
    return;
  }

  const existingSession = sessionStore.getSession(tabId);
  let sessionEpoch: number;

  if (!existingSession || existingSession.pageUrl !== url) {
    const session = sessionStore.resetSessionForNewPage(tabId, url, 'scanning');
    sessionEpoch = session.scanEpoch;
  } else {
    sessionStore.setScanStatus(tabId, 'scanning');
    sessionEpoch = existingSession.scanEpoch;
  }

  await injectAndStartScanner(tabId, sessionEpoch);
}

export async function triggerTabRescan(tabId: number): Promise<boolean> {
  await sessionStore.ensureHydrated();
  const session = sessionStore.getSession(tabId);
  if (!session) return false;

  sessionStore.setScanStatus(tabId, 'scanning');
  return injectAndStartScanner(tabId, session.scanEpoch);
}

async function injectAndStartScanner(
  tabId: number,
  scanEpoch: number,
): Promise<boolean> {
  // 1. Try pinging existing content script first
  try {
    const pingRes = (await chrome.tabs.sendMessage(tabId, {
      channel: 'WIC_BG_TO_CONTENT',
      type: 'BG_PING_CONTENT',
    })) as MessageResult;

    if (pingRes?.ok) {
      await chrome.tabs.sendMessage(tabId, {
        channel: 'WIC_BG_TO_CONTENT',
        type: 'BG_START_OR_RESCAN',
        scanEpoch,
      });
      return true;
    }
  } catch {
    // Content script not yet present or context invalidated
  }

  // 2. Inject content script via chrome.scripting
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCANNER_SCRIPT_PATH],
    });

    await chrome.tabs.sendMessage(tabId, {
      channel: 'WIC_BG_TO_CONTENT',
      type: 'BG_START_OR_RESCAN',
      scanEpoch,
    });
    return true;
  } catch (err) {
    console.warn('[WIC] Injection failed (activeTab may have expired):', err);
    sessionStore.setScanStatus(
      tabId,
      'stale',
      'ページが再読込または移動しました。ブラウザ右上の拡張機能アイコンをクリックしてください',
    );
    return false;
  }
}

export function handleTabNavigation(tabId: number): void {
  const session = sessionStore.getSession(tabId);
  if (!session || session.scanStatus === 'unscanned') return;

  // Verify whether content script is still responsive
  setTimeout(async () => {
    try {
      const ping = (await chrome.tabs.sendMessage(tabId, {
        channel: 'WIC_BG_TO_CONTENT',
        type: 'BG_PING_CONTENT',
      })) as MessageResult;

      if (!ping?.ok) {
        sessionStore.setScanStatus(
          tabId,
          'stale',
          'ページが移動しました。ブラウザ右上の拡張機能アイコンをクリックしてください',
        );
      }
    } catch {
      sessionStore.setScanStatus(
        tabId,
        'stale',
        'ページが移動しました。ブラウザ右上の拡張機能アイコンをクリックしてください',
      );
    }
  }, 500);
}

export function isScannableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'file:'
    );
  } catch {
    return false;
  }
}

import { CONTENT_SCANNER_SCRIPT_PATH } from '@shared/constants';
import type { MessageResult } from '@shared/messages';
import { sessionStore } from './session-store';

export async function bootstrapTabScan(
  tab: chrome.tabs.Tab,
  openPanelPromise?: Promise<void>,
): Promise<void> {
  if (openPanelPromise) {
    await openPanelPromise.catch((err: unknown) => {
      console.error('[WIC] Failed to open Side Panel:', err);
    });
  }

  const tabId = tab.id;
  if (tabId === undefined) return;

  await sessionStore.ensureHydrated();

  const url = tab.url || '';
  if (!isScannableUrl(url)) {
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      `このページ (${url ? new URL(url).protocol : '内部ページ'}) はブラウザの保護ページのためスキャンできません。画像のある通常のWebページを開いてください`,
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

  // Retrieve current tab info to ensure URL and domain are up to date
  let currentUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    currentUrl = tab.url || '';
  } catch (err) {
    console.warn('[WIC] Failed to get tab info for tabId:', tabId, err);
  }

  let session = sessionStore.getSession(tabId);
  if (!session) {
    session = sessionStore.getOrCreateSession(tabId, currentUrl);
  } else if (currentUrl && (!session.pageUrl || session.pageUrl !== currentUrl)) {
    session = sessionStore.resetSessionForNewPage(tabId, currentUrl, 'scanning');
  }

  const urlToCheck = currentUrl || session.pageUrl || '';
  if (!isScannableUrl(urlToCheck)) {
    const protocolHint = urlToCheck ? `${urlToCheck.slice(0, 30)}...` : '内部ページ';
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      `このページ (${protocolHint}) はブラウザの保護ページ（拡張機能画面や設定等）のためスキャンできません。画像のある通常のWebサイトを開いてください`,
    );
    return false;
  }

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
      'このタブをスキャンするには、ブラウザ右上のツールバーにある拡張機能アイコン（Web Image Collector）をクリックしてください',
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

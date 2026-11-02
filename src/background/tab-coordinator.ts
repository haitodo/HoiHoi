import { CONTENT_SCANNER_SCRIPT_PATH } from '@shared/constants';
import type { MessageResult } from '@shared/messages';
import { refererRuleManager } from './referer-rules';
import { sessionStore } from './session-store';

export async function bootstrapTabScan(
  tab: chrome.tabs.Tab,
  openPanelPromise?: Promise<void>,
): Promise<void> {
  if (openPanelPromise) {
    const opened = await openPanelPromise.then(() => true).catch((err: unknown) => {
      console.error('[WIC] Failed to open Side Panel:', err);
      return false;
    });
    if (!opened) return;
  }

  const tabId = tab.id;
  if (tabId === undefined) return;

  await sessionStore.ensureHydrated();

  const url = tab.url || '';
  const title = tab.title;
  if (!isScannableUrl(url)) {
    void refererRuleManager.setActiveTabContext(undefined);
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      `このページ (${url ? new URL(url).protocol : '内部ページ'}) はブラウザの保護ページのためスキャンできません。画像のある通常のWebページを開いてください`,
    );
    return;
  }

  void refererRuleManager.setActiveTabContext(url);

  const existingSession = sessionStore.getSession(tabId);
  let sessionEpoch: number;

  if (!existingSession || existingSession.pageUrl !== url) {
    const session = sessionStore.resetSessionForNewPage(tabId, url, 'scanning', title);
    sessionEpoch = session.scanEpoch;
  } else {
    if (title) {
      sessionStore.updatePageTitle(tabId, title);
    }
    existingSession.scanEpoch += 1;
    sessionStore.setScanStatus(tabId, 'scanning');
    sessionEpoch = existingSession.scanEpoch;
  }

  await injectAndStartScanner(tabId, sessionEpoch);
}

export async function triggerTabRescan(tabId: number): Promise<boolean> {
  await sessionStore.ensureHydrated();

  // Retrieve current tab info to ensure URL, title and domain are up to date
  let currentUrl = '';
  let currentTitle = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    currentUrl = tab.url || '';
    currentTitle = tab.title || '';
  } catch (err) {
    console.warn('[WIC] Failed to get tab info for tabId:', tabId, err);
  }

  let session = sessionStore.getSession(tabId);
  if (!session) {
    session = sessionStore.getOrCreateSession(tabId, currentUrl, currentTitle);
  } else if (currentUrl && (!session.pageUrl || session.pageUrl !== currentUrl)) {
    session = sessionStore.resetSessionForNewPage(tabId, currentUrl, 'scanning', currentTitle);
  } else if (currentTitle) {
    sessionStore.updatePageTitle(tabId, currentTitle);
  }

  const urlToCheck = currentUrl || session.pageUrl || '';
  if (!isScannableUrl(urlToCheck)) {
    void refererRuleManager.setActiveTabContext(undefined);
    const protocolHint = urlToCheck ? `${urlToCheck.slice(0, 30)}...` : '内部ページ';
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      `このページ (${protocolHint}) はブラウザの保護ページ（拡張機能画面や設定等）のためスキャンできません。画像のある通常のWebサイトを開いてください`,
    );
    return false;
  }

  void refererRuleManager.setActiveTabContext(urlToCheck);
  session.scanEpoch += 1;
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
      void chrome.runtime.sendMessage({ type: 'HOIHOI_SCANNER_READY', tabId }).catch(() => {});
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
    sessionStore.announceSnapshot(tabId);
    void chrome.runtime.sendMessage({ type: 'HOIHOI_SCANNER_READY', tabId }).catch(() => {});
    return true;
  } catch (err) {
    console.warn('[WIC] Injection failed (activeTab may have expired):', err);
    sessionStore.setScanStatus(
      tabId,
      'stale',
      'このタブをスキャンするには、ブラウザ右上のツールバーにある拡張機能アイコン（HoiHoi）をクリックしてください',
    );
    return false;
  }
}

export function handleTabNavigation(tabId: number): void {
  const session = sessionStore.getSession(tabId);
  if (!session || session.scanStatus === 'unscanned' || session.scanStatus === 'stale') return;
  sessionStore.setScanStatus(tabId, 'stale',
    'ページが移動しました。ブラウザ右上の拡張機能アイコンをクリックしてください');
}

export async function stopTabScanner(tabId: number, releaseData = false): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      channel: 'WIC_BG_TO_CONTENT',
      type: 'BG_STOP_SCANNER',
      releaseData,
    });
  } catch {
    // Tab might be closed or script not present; ignore cleanly
  }
}

export async function stopAllScanners(): Promise<void> {
  const tabIds = sessionStore.getAllTrackedTabIds();
  await Promise.allSettled(tabIds.map((id) => stopTabScanner(id)));
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

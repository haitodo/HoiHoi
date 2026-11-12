import { CONTENT_SCANNER_SCRIPT_PATH } from '@shared/constants';
import type { MessageResult } from '@shared/messages';
import { refererRuleManager } from './referer-rules';
import { sessionStore } from './session-store';

const pendingScanStarts = new Map<number, Promise<boolean>>();

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

  await startTabScan(tabId, url, title);
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

  const session = sessionStore.getSession(tabId);
  const urlToCheck = currentUrl || session?.pageUrl || '';
  if (!isScannableUrl(urlToCheck)) {
    void refererRuleManager.setActiveTabContext(undefined);
    if (session && currentUrl && session.pageUrl !== currentUrl) {
      sessionStore.resetSessionForNewPage(tabId, currentUrl, 'restricted', currentTitle);
    } else {
      sessionStore.getOrCreateSession(tabId, currentUrl, currentTitle);
      if (currentTitle) sessionStore.updatePageTitle(tabId, currentTitle);
    }
    const protocolHint = urlToCheck ? `${urlToCheck.slice(0, 30)}...` : '内部ページ';
    sessionStore.setScanStatus(
      tabId,
      'restricted',
      `このページ (${protocolHint}) はブラウザの保護ページ（拡張機能画面や設定等）のためスキャンできません。画像のある通常のWebサイトを開いてください`,
    );
    return false;
  }

  return startTabScan(tabId, urlToCheck, currentTitle);
}

function startTabScan(tabId: number, pageUrl: string, pageTitle?: string): Promise<boolean> {
  const session = sessionStore.getSession(tabId);
  const pending = pendingScanStarts.get(tabId);
  if (pending) {
    if (session?.pageUrl === pageUrl && session.scanStatus !== 'stale' && session.scanStatus !== 'restricted') {
      return pending;
    }
    // The previous document may still be finishing injection. Check the URL again after it settles.
    return pending.then(async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      return tab?.url === pageUrl ? startTabScan(tabId, pageUrl, tab.title) : false;
    });
  }

  void refererRuleManager.setActiveTabContext(pageUrl);
  let scanEpoch: number;
  if (session?.pageUrl === pageUrl) {
    if (pageTitle) sessionStore.updatePageTitle(tabId, pageTitle);
    scanEpoch = session.scanEpoch + 1;
    sessionStore.setScanStatus(tabId, 'scanning', undefined, scanEpoch);
  } else {
    scanEpoch = sessionStore.resetSessionForNewPage(tabId, pageUrl, 'scanning', pageTitle).scanEpoch;
  }

  const start = injectAndStartScanner(tabId, scanEpoch).finally(() => pendingScanStarts.delete(tabId));
  pendingScanStarts.set(tabId, start);
  return start;
}

async function injectAndStartScanner(
  tabId: number,
  scanEpoch: number,
): Promise<boolean> {
  const isCurrentScan = () => {
    const session = sessionStore.getSession(tabId);
    return session?.scanEpoch === scanEpoch && session.scanStatus !== 'stale' && session.scanStatus !== 'restricted';
  };

  const startScanner = async () => {
    if (!isCurrentScan()) return false;
    const response = (await chrome.tabs.sendMessage(tabId, {
      channel: 'WIC_BG_TO_CONTENT',
      type: 'BG_START_OR_RESCAN',
      scanEpoch,
    })) as MessageResult | undefined;
    if (!response?.ok) throw new Error(response?.error ?? 'Scanner did not acknowledge the start request');
    if (!isCurrentScan()) return false;

    sessionStore.announceSnapshot(tabId);
    void chrome.runtime.sendMessage({ type: 'HOIHOI_SCANNER_READY', tabId }).catch(() => {});
    return true;
  };

  // 1. Try pinging existing content script first
  try {
    const pingRes = (await chrome.tabs.sendMessage(tabId, {
      channel: 'WIC_BG_TO_CONTENT',
      type: 'BG_PING_CONTENT',
    })) as MessageResult;

    if (pingRes?.ok) return await startScanner();
  } catch {
    // Content script not yet present or context invalidated
  }

  // 2. Inject content script via chrome.scripting
  if (!isCurrentScan()) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCANNER_SCRIPT_PATH],
    });

    return await startScanner();
  } catch (err) {
    if (!isCurrentScan()) return false;
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

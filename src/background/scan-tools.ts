import { MAX_ITEMS_PER_TAB, PORT_NAMES } from '@shared/constants';
import { isCollectionPageUrl } from '@shared/pagination-utils';
import type { RunScanToolMessage, ScanToolProgressMessage, StartScanToolMessage } from '@shared/messages';
import { sessionStore } from './session-store';

/** One panel-owned port per explicit run. Disconnect tears down page work, including pending I/O. */
export function attachScanToolBridge(panel: chrome.runtime.Port, watches: (tabId: number) => boolean): void {
  let closed = false;
  let started = false;
  let terminal = false;
  let content: chrome.runtime.Port | undefined;
  panel.onDisconnect.addListener(() => { closed = true; content?.disconnect(); });
  panel.onMessage.addListener((message: StartScanToolMessage) => {
    if (started || message?.type !== 'START_SCAN_TOOL') return;
    started = true;
    const fail = (error: string) => {
      terminal = true;
      if (!closed) panel.postMessage({ type: 'SCAN_TOOL_PROGRESS', progress: {
        tool: message.tool, status: 'failed', current: 0, message: error,
      } } satisfies ScanToolProgressMessage);
      content?.disconnect();
    };
    void (async () => {
      try {
        if (panel.sender?.tab || !['dimensions', 'scroll', 'pages'].includes(message.tool)) throw new Error('追加スキャンを開始できません');
        await sessionStore.ensureHydrated();
        if (closed) return;
        const session = sessionStore.getSession(message.tabId);
        if (!session?.pageUrl || session.scanEpoch !== message.scanEpoch || !watches(message.tabId) ||
          !['scanning', 'watching', 'limit_reached'].includes(session.scanStatus)) {
          throw new Error('対象ページをスキャンしてから実行してください');
        }
        const tab = await chrome.tabs.get(message.tabId);
        if (closed) return;
        if (tab.url !== session.pageUrl) throw new Error('ページが移動しました。再スキャンしてください');
        if (message.tool === 'pages' && !isCollectionPageUrl(session.pageUrl)) throw new Error('通常のWebページで実行してください');
        const urls = message.tool === 'dimensions' ? session.items.flatMap((item) => {
          const variant = item.variants.find((entry) => entry.url === item.selectedUrl);
          return variant && (!variant.naturalWidth || !variant.naturalHeight) && !variant.largeDataRefId ? [variant.url] : [];
        }).slice(0, MAX_ITEMS_PER_TAB) : [];
        content = chrome.tabs.connect(message.tabId, { name: PORT_NAMES.SCAN_TOOLS, frameId: 0 });
        content.onMessage.addListener((reply: ScanToolProgressMessage) => {
          if (closed || terminal || reply?.type !== 'SCAN_TOOL_PROGRESS') return;
          const current = sessionStore.getSession(message.tabId);
          if (!current || current.scanEpoch !== message.scanEpoch || current.pageUrl !== session.pageUrl || current.scanStatus === 'stale') {
            fail('ページが変更されたため停止しました'); return;
          }
          terminal = reply.progress.status !== 'running';
          panel.postMessage(reply);
        });
        content.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (!terminal && !closed) fail('ページとの接続が切れたため停止しました');
        });
        content.postMessage({ type: 'RUN_SCAN_TOOL', tool: message.tool, scanEpoch: message.scanEpoch,
          pageUrl: session.pageUrl, urls, orderStart: session.items.reduce((max, item) => Math.max(max, item.firstSeenOrder), 0),
        } satisfies RunScanToolMessage);
      } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    })();
  });
}

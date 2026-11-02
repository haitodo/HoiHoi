import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PORT_NAMES } from '@shared/constants';

const mocks = vi.hoisted(() => ({
  store: { onEvent: vi.fn(), onCacheEvicted: vi.fn(), ensureHydrated: vi.fn(async () => {}),
    getSession: vi.fn(() => ({ scanStatus: 'watching', scanEpoch: 1 })), setActiveTabs: vi.fn(),
    hasPendingDownloads: vi.fn(() => false), flush: vi.fn(async () => {}), announceSnapshot: vi.fn(),
    updatePageTitle: vi.fn(), mergeCandidateGroups: vi.fn(), removeTab: vi.fn() },
  network: { setWatchedTabs: vi.fn() },
  downloads: { setProgressSubscribers: vi.fn(), init: vi.fn(async () => {}), handleDownloadDelta: vi.fn() },
  rules: { clearIdleRulesIfPossible: vi.fn(async () => {}) },
  coordinator: { stopTabScanner: vi.fn(async () => {}), handleTabNavigation: vi.fn(),
    bootstrapTabScan: vi.fn(), triggerTabRescan: vi.fn() },
}));
vi.mock('../session-store', () => ({ sessionStore: mocks.store }));
vi.mock('../network-sniffer', () => ({ networkSniffer: mocks.network }));
vi.mock('../download-manager', () => ({ downloadManager: mocks.downloads }));
vi.mock('../referer-rules', () => ({ refererRuleManager: mocks.rules }));
vi.mock('../tab-coordinator', () => mocks.coordinator);

function event() {
  const callbacks = new Set<(...args: any[]) => unknown>();
  return { addListener: (callback: (...args: any[]) => unknown) => callbacks.add(callback),
    emit: (...args: any[]) => [...callbacks].map((callback) => callback(...args)) };
}

describe('background idle lifecycle', () => {
  let tabs: { onUpdated: ReturnType<typeof event>; onRemoved: ReturnType<typeof event> };
  let runtime: { onInstalled: ReturnType<typeof event>; onConnect: ReturnType<typeof event>;
    onMessage: ReturnType<typeof event>; sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    tabs = { onUpdated: event(), onRemoved: event() };
    runtime = { onInstalled: event(), onConnect: event(), onMessage: event(), sendMessage: vi.fn(async () => {}) };
    vi.stubGlobal('chrome', { tabs, runtime, action: { onClicked: event() }, downloads: { onChanged: event() } });
    await import('../index');
  });

  it('ignores title updates even for previously scanned tabs while no panel watches them', () => {
    tabs.onUpdated.emit(10, { title: 'Live timer 01:23' });
    expect(mocks.store.updatePageTitle).not.toHaveBeenCalled();
    const port = { name: PORT_NAMES.SIDEPANEL_LIFECYCLE, onMessage: event(), onDisconnect: event() };
    runtime.onConnect.emit(port);
    port.onMessage.emit({ type: 'PANEL_WATCH_TAB', tabId: 10 });
    tabs.onUpdated.emit(10, { title: 'Viewed page' });
    expect(mocks.store.updatePageTitle).toHaveBeenCalledOnce();
    port.onDisconnect.emit();
    tabs.onUpdated.emit(10, { title: 'Idle timer 01:24' });
    expect(mocks.store.updatePageTitle).toHaveBeenCalledOnce();
    expect(mocks.network.setWatchedTabs).toHaveBeenLastCalledWith([]);
  });

  it('drops stale in-flight scan batches after rescan/page replacement', async () => {
    const response = vi.fn();
    runtime.onMessage.emit({ channel: 'WIC_CONTENT_TO_BG', type: 'CONTENT_SCAN_BATCH',
      scanEpoch: 0, groups: [{ primaryUrl: 'https://example.com/old.jpg' }] }, { tab: { id: 10 } }, response);
    await Promise.resolve();
    expect(mocks.store.mergeCandidateGroups).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith({ ok: true });
  });

  it('restores subscriptions after a worker wake without timers or automatic rescans', async () => {
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'HOIHOI_BACKGROUND_READY' });
    const port = { name: PORT_NAMES.SIDEPANEL_LIFECYCLE, onMessage: event(), onDisconnect: event() };
    runtime.onConnect.emit(port);
    port.onMessage.emit({ type: 'PANEL_WATCH_TAB', tabId: 10 });
    await Promise.resolve();
    expect(mocks.store.announceSnapshot).toHaveBeenCalledWith(10);
    expect(mocks.network.setWatchedTabs).toHaveBeenLastCalledWith([10]);
    expect(mocks.coordinator.triggerTabRescan).not.toHaveBeenCalled();
    expect(mocks.coordinator.bootstrapTabScan).not.toHaveBeenCalled();
  });
});

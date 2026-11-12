import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@shared/constants';
import type { BackgroundToContentMessage } from '@shared/messages';

vi.mock('../referer-rules', () => ({
  refererRuleManager: { setActiveTabContext: vi.fn() },
}));

const tab = { id: 10, url: 'https://example.com/gallery' };
const getTab = vi.fn();
const sendToTab = vi.fn(async (_tabId: number, _message: BackgroundToContentMessage) => ({ ok: true }));
const executeScript = vi.fn();
const sendToPanel = vi.fn(async () => {});
const saveSessions = vi.fn(async () => {});

describe('scan startup', () => {
  let finishInjection: () => void;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    getTab.mockResolvedValue(tab);
    sendToTab.mockRejectedValueOnce(new Error('No content receiver'));
    executeScript.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishInjection = resolve;
    }));
    vi.stubGlobal('chrome', {
      tabs: { get: getTab, sendMessage: sendToTab },
      scripting: { executeScript },
      runtime: { sendMessage: sendToPanel },
      storage: { session: { get: vi.fn(async () => ({})), set: saveSessions } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares pending injection and allows a new scan while traversal is still in progress', async () => {
    const { bootstrapTabScan, triggerTabRescan } = await import('../tab-coordinator');
    const { sessionStore } = await import('../session-store');
    const bootstrap = bootstrapTabScan(tab as chrome.tabs.Tab);
    await vi.advanceTimersByTimeAsync(0);

    const rescan = triggerTabRescan(tab.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(executeScript).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledOnce();

    finishInjection();
    await bootstrap;
    await expect(rescan).resolves.toBe(true);
    expect(sendToPanel).toHaveBeenCalledOnce();
    const initial = sessionStore.getSnapshot(tab.id);
    expect(initial.scanStatus).toBe('scanning');
    await sessionStore.flush();
    saveSessions.mockClear();

    const onSessionEvent = vi.fn();
    sessionStore.onEvent(onSessionEvent);
    await expect(triggerTabRescan(tab.id)).resolves.toBe(true);
    expect(sendToTab).toHaveBeenLastCalledWith(tab.id, expect.objectContaining({
      type: 'BG_START_OR_RESCAN', scanEpoch: initial.scanEpoch + 1,
    }));
    const restarted = sessionStore.getSnapshot(tab.id);
    expect(restarted.revision).toBeGreaterThan(initial.revision);
    expect(onSessionEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'EVENT_SESSION_REPLACED', snapshot: restarted,
    }));
    await sessionStore.flush();
    expect(saveSessions).toHaveBeenCalledWith({ [`${STORAGE_KEYS.TAB_SESSION_PREFIX}${tab.id}`]: restarted });
  });

  it('starts the new page only after pending injection for the previous page settles', async () => {
    const { bootstrapTabScan, handleTabNavigation, triggerTabRescan } = await import('../tab-coordinator');
    const { sessionStore } = await import('../session-store');
    const bootstrap = bootstrapTabScan(tab as chrome.tabs.Tab);
    await vi.advanceTimersByTimeAsync(0);

    const nextTab = { ...tab, url: `${tab.url}/next` };
    getTab.mockResolvedValue(nextTab);
    handleTabNavigation(tab.id);
    const rescan = triggerTabRescan(tab.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendToTab).toHaveBeenCalledOnce();

    finishInjection();
    await bootstrap;
    await expect(rescan).resolves.toBe(true);
    const starts = sendToTab.mock.calls.map(([, message]) => message).filter((message) => message.type === 'BG_START_OR_RESCAN');
    expect(starts).toEqual([expect.objectContaining({ scanEpoch: 2 })]);
    expect(sessionStore.getSnapshot(tab.id).pageUrl).toBe(nextTab.url);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PanelSubscriptions } from '../panel-subscriptions';

function panel() {
  let message: (value: unknown) => void = () => {};
  let disconnect: () => void = () => {};
  const port = {
    onMessage: { addListener: (callback: typeof message) => { message = callback; } },
    onDisconnect: { addListener: (callback: typeof disconnect) => { disconnect = callback; } },
  } as unknown as chrome.runtime.Port;
  return { port, watch: (tabId: unknown) => message({ type: 'PANEL_WATCH_TAB', tabId }),
    disconnect: () => disconnect() };
}

describe('panel subscriptions', () => {
  it('only watches the current target and ignores repeated/invalid targets', () => {
    const changed = vi.fn();
    const subscriptions = new PanelSubscriptions(changed);
    const first = panel();
    subscriptions.add(first.port);
    expect(subscriptions.getTabIds().size).toBe(0);
    first.watch(10);
    first.watch(10);
    expect(changed).toHaveBeenCalledTimes(1);
    first.watch(20);
    expect(subscriptions.watches(10)).toBe(false);
    expect(subscriptions.watches(20)).toBe(true);
    first.watch(-1);
    expect(subscriptions.getTabIds().size).toBe(0);
    first.watch('20');
    expect(subscriptions.getTabIds().size).toBe(0);
  });

  it('keeps another window watching the same tab until the final panel disconnects', () => {
    const subscriptions = new PanelSubscriptions(() => {});
    const first = panel();
    const second = panel();
    subscriptions.add(first.port);
    subscriptions.add(second.port);
    first.watch(10);
    second.watch(10);
    first.disconnect();
    expect(subscriptions.watches(10)).toBe(true);
    second.disconnect();
    expect(subscriptions.getTabIds().size).toBe(0);
  });
});

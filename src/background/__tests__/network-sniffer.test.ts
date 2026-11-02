import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkVideoSniffer } from '../network-sniffer';
import type { SessionStore } from '../session-store';

afterEach(() => vi.unstubAllGlobals());

describe('network monitoring scope', () => {
  it('registers tab-filtered listeners and removes only subscriptions that are no longer used', () => {
    const redirects = { addListener: vi.fn(), removeListener: vi.fn() };
    const headers = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('chrome', { webRequest: { onBeforeRedirect: redirects, onHeadersReceived: headers } });
    const sniffer = new NetworkVideoSniffer({} as SessionStore);
    sniffer.setWatchedTabs([10, 20]);
    expect(headers.addListener.mock.calls.map((call) => call[1].tabId)).toEqual([10, 20]);
    sniffer.setWatchedTabs([10, 20]);
    expect(headers.addListener).toHaveBeenCalledTimes(2);
    sniffer.setWatchedTabs([20]);
    expect(headers.removeListener).toHaveBeenCalledWith(headers.addListener.mock.calls[0]![0]);
    expect(headers.removeListener).toHaveBeenCalledTimes(1);
    sniffer.stopSniffing();
    expect(headers.removeListener).toHaveBeenCalledTimes(2);
    expect(sniffer.isSniffing()).toBe(false);
  });
});

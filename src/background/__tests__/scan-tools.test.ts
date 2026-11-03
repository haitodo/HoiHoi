import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PORT_NAMES } from '@shared/constants';
import { attachScanToolBridge } from '../scan-tools';

const mocks = vi.hoisted(() => ({ session: undefined as any, hydrate: vi.fn(async () => {}) }));
vi.mock('../session-store', () => ({ sessionStore: {
  ensureHydrated: mocks.hydrate, getSession: () => mocks.session,
} }));
function event() {
  const listeners: Array<(...args: any[]) => void> = [];
  return { addListener: (listener: (...args: any[]) => void) => listeners.push(listener),
    emit: (...args: any[]) => listeners.forEach((listener) => listener(...args)) };
}
function port() {
  let disconnected = false;
  const value = { onMessage: event(), onDisconnect: event(), postMessage: vi.fn(),
    disconnect: vi.fn(() => { if (!disconnected) { disconnected = true; value.onDisconnect.emit(); } }) };
  return value;
}

describe('scan tool ownership bridge', () => {
  let panel: ReturnType<typeof port>;
  let content: ReturnType<typeof port>;
  let connect: ReturnType<typeof vi.fn>;
  const url = 'https://www.v2ph.com/album/a54xo3nz.html?hl=ja';
  beforeEach(() => {
    panel = port(); content = port(); connect = vi.fn(() => content);
    mocks.hydrate.mockReset().mockResolvedValue();
    mocks.session = { pageUrl: url, scanEpoch: 1, scanStatus: 'watching', items: [
      { selectedUrl: 'https://cdn.example/unknown.jpg', firstSeenOrder: 10,
        variants: [{ url: 'https://cdn.example/unknown.jpg', naturalWidth: null, naturalHeight: null }] },
      { selectedUrl: 'https://cdn.example/known.jpg', firstSeenOrder: 20,
        variants: [{ url: 'https://cdn.example/known.jpg', naturalWidth: 1500, naturalHeight: 2500 }] },
    ] };
    vi.stubGlobal('chrome', { runtime: {}, tabs: { get: vi.fn(async () => ({ url })), connect } });
  });
  afterEach(() => vi.unstubAllGlobals());
  function start(tool = 'dimensions') { panel.onMessage.emit({ type: 'START_SCAN_TOOL', tabId: 1, scanEpoch: 1, tool }); }
  it('does nothing until a user starts a run, and supplies only missing dimensions from the current session', async () => {
    attachScanToolBridge(panel as any, () => true);
    expect(connect).not.toHaveBeenCalled(); expect(chrome.tabs.get).not.toHaveBeenCalled();
    start();
    await vi.waitFor(() => expect(content.postMessage).toHaveBeenCalled());
    expect(connect).toHaveBeenCalledWith(1, { name: PORT_NAMES.SCAN_TOOLS, frameId: 0 });
    expect(content.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RUN_SCAN_TOOL', urls: ['https://cdn.example/unknown.jpg'], pageUrl: url, orderStart: 20,
    }));
    panel.disconnect(); expect(content.disconnect).toHaveBeenCalledOnce();
  });
  it('does not start a page task when the owner closes while hydration is pending', async () => {
    let finish!: () => void;
    mocks.hydrate.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    attachScanToolBridge(panel as any, () => true); start(); panel.disconnect(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(connect).not.toHaveBeenCalled();
  });
  it('rejects an unwatched or navigated page without connecting to content', async () => {
    attachScanToolBridge(panel as any, () => false); start('scroll');
    await vi.waitFor(() => expect(panel.postMessage).toHaveBeenCalled());
    expect(connect).not.toHaveBeenCalled();
    expect(panel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      progress: expect.objectContaining({ status: 'failed' }),
    }));
  });
  it('drops progress from an old epoch and disconnects the page task', async () => {
    attachScanToolBridge(panel as any, () => true); start();
    await vi.waitFor(() => expect(content.postMessage).toHaveBeenCalled());
    mocks.session.scanEpoch = 2;
    content.onMessage.emit({ type: 'SCAN_TOOL_PROGRESS', progress: { tool: 'dimensions', status: 'running', current: 1, message: 'old' } });
    expect(panel.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ progress: expect.objectContaining({ status: 'failed' }) }));
    expect(content.disconnect).toHaveBeenCalledOnce();
  });
  it('allows explicit page collection on other HTTP sites without requiring a site allowlist', async () => {
    mocks.session.pageUrl = 'https://photos.example/gallery';
    vi.mocked(chrome.tabs.get).mockResolvedValue({ url: mocks.session.pageUrl } as chrome.tabs.Tab);
    attachScanToolBridge(panel as any, () => true); start('pages');
    await vi.waitFor(() => expect(content.postMessage).toHaveBeenCalled());
    expect(content.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RUN_SCAN_TOOL', tool: 'pages', pageUrl: 'https://photos.example/gallery',
    }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChunkRunner } from '../chunk-runner';
import { extractFromImageElement } from '../dom-extractor';

vi.mock('../dom-extractor', () => ({
  extractFromImageElement: vi.fn((image) => ({ occurrenceKey: `img_${image.id}`, primaryUrl: image.url,
    domOrder: image.id, variants: [{ url: image.url, role: 'src', source: 'img', naturalWidth: image.width, naturalHeight: 100 }] })),
  extractFromCssBackground: () => [], extractFromLazyAttributes: () => null, extractFromSvgImage: () => null,
}));
vi.mock('../video-extractor', () => ({
  iterateEmbeddedScriptAndConfigVideos: function* () {}, iteratePageMetadataVideos: function* () {},
  extractPageFallbackVideoMeta: () => undefined, extractFromVideoLinkOrLazyElement: () => null,
}));
vi.mock('../network-media-observer', () => ({ createNetworkMediaObserver: () => ({
  startObserving: vi.fn(), stopObserving: vi.fn(), scanBufferedEntries: () => [], resetSeenUrls: vi.fn(),
}) }));

class FakeElement {
  children: FakeElement[] = [];
  isConnected = true;
  shadowRoot = null;
  style = '';
  matches() { return false; }
  getAttribute() { return this.style; }
  getRootNode() { return {}; }
}
class FakeImage extends FakeElement {
  width = 100;
  url: string;
  constructor(public id: number) { super(); this.url = `https://example.com/${id}.jpg`; }
  override matches() { return true; }
}
function* descendants(root: { children: FakeElement[] }): Generator<FakeElement> {
  for (const child of root.children) { yield child; yield* descendants(child); }
}

describe('incremental scanner scheduling', () => {
  let root: { children: FakeElement[] };
  let onMutation: (records: any[]) => void;
  let send: ReturnType<typeof vi.fn>;
  let runner: ReturnType<typeof createChunkRunner>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.clearAllMocks();
    root = { children: [] };
    send = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: send } });
    vi.stubGlobal('window', { location: { href: 'https://example.com' }, setTimeout,
      addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { ...root, baseURI: 'https://example.com', title: 'Test',
      documentElement: new FakeElement(), getElementsByTagName: () => [],
      createTreeWalker: (value: typeof root) => {
        const iterator = descendants(value);
        return { nextNode: () => { const next = iterator.next(); return next.done ? null : next.value; } };
      },
    });
    vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1 });
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('HTMLImageElement', FakeImage);
    for (const name of ['HTMLVideoElement', 'HTMLSourceElement', 'SVGImageElement', 'ShadowRoot']) {
      vi.stubGlobal(name, class extends FakeElement {});
    }
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: typeof onMutation) { onMutation = callback; }
      observe() {} disconnect() {}
    });
    runner = createChunkRunner({ largeDataUrlStore: new Map() });
  });
  afterEach(() => { runner.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('yields during traversal and cancels all pending work on stop', async () => {
    root.children.push(...Array.from({ length: 100 }, (_, id) => new FakeImage(id)));
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time++);
    runner.startOrRescan(1);
    await vi.advanceTimersToNextTimerAsync();
    const processed = vi.mocked(extractFromImageElement).mock.calls.length;
    expect(processed).toBeLessThan(100);
    runner.destroy();
    await vi.runAllTimersAsync();
    expect(extractFromImageElement).toHaveBeenCalledTimes(processed);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not traverse added subtrees inside the mutation callback', async () => {
    runner.startOrRescan(1); await vi.runAllTimersAsync();
    const container = new FakeElement(); container.children = [new FakeImage(1)];
    const query = vi.fn(() => { throw new Error('synchronous subtree traversal'); });
    Object.assign(container, { querySelectorAll: query });
    onMutation([{ type: 'childList', addedNodes: [container] }]);
    expect(query).not.toHaveBeenCalled();
    expect(extractFromImageElement).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(extractFromImageElement).toHaveBeenCalledOnce();
  });

  it('does not schedule work for unrelated style animations or resend unchanged images', async () => {
    const image = new FakeImage(1); root.children.push(image);
    runner.startOrRescan(1); await vi.runAllTimersAsync();
    const batches = () => send.mock.calls.filter((call: any[]) => call[0]?.type === 'CONTENT_SCAN_BATCH');
    expect(batches()).toHaveLength(1);
    const animated = new FakeElement(); animated.style = 'transform:translateX(1px)';
    onMutation([{ type: 'attributes', attributeName: 'style', target: animated }]);
    expect(vi.getTimerCount()).toBe(0);
    onMutation([{ type: 'attributes', attributeName: 'src', target: image }]);
    await vi.runAllTimersAsync();
    expect(batches()).toHaveLength(1);
    image.width = 200;
    onMutation([{ type: 'attributes', attributeName: 'src', target: image }]);
    await vi.runAllTimersAsync();
    expect(batches()).toHaveLength(2);
  });

  it('limits unacknowledged IPC batches and waits without spinning timers', async () => {
    root.children.push(...Array.from({ length: 150 }, (_, id) => new FakeImage(id)));
    const resolveBatches: Array<(value: unknown) => void> = [];
    send.mockImplementation((message: { type: string }) => message.type === 'CONTENT_SCAN_BATCH'
      ? new Promise((resolve) => resolveBatches.push(resolve)) : Promise.resolve({ ok: true }));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    runner.startOrRescan(1);
    await vi.runAllTimersAsync();
    expect(resolveBatches).toHaveLength(2);
    expect(extractFromImageElement).toHaveBeenCalledTimes(45);
    expect(vi.getTimerCount()).toBe(0);
    resolveBatches[0]!({ ok: true }); await vi.runAllTimersAsync();
    expect(resolveBatches).toHaveLength(3);
    runner.destroy();
    resolveBatches.forEach((resolve) => resolve({ ok: true }));
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });
});

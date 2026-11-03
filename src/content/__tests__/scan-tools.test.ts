import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_PROBE_TIMEOUT_MS } from '@shared/constants';
import { createScanToolsController, probeDimensions, probeImageDimensions, scrollPage } from '../scan-tools';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('optional dimension probes', () => {
  it('bounds parallel image loads, deduplicates URLs, and reports decoded dimensions', async () => {
    const callbacks: Array<() => void> = [];
    const probe = vi.fn(() => new Promise<{ width: number; height: number }>((resolve) => {
      callbacks.push(() => resolve({ width: 1500, height: 2500 }));
    }));
    const onDimension = vi.fn(async () => {});
    const progress = vi.fn();
    const result = probeDimensions({ urls: ['a', 'b', 'c', 'd', 'a'], signal: new AbortController().signal,
      probe, onDimension, onProgress: progress });
    expect(probe).toHaveBeenCalledTimes(3);
    callbacks[0]!(); await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(4));
    callbacks.slice(1).forEach((complete) => complete());
    await result;
    expect(onDimension).toHaveBeenCalledTimes(4);
    expect(onDimension).toHaveBeenCalledWith('d', 1500, 2500);
    expect(progress).toHaveBeenLastCalledWith(4, 4, 0);
  });
  it('does not publish late results or start more work after cancellation', async () => {
    const controller = new AbortController();
    let complete!: (value: { width: number; height: number }) => void;
    const probe = vi.fn(() => new Promise<{ width: number; height: number }>((resolve) => { complete = resolve; }));
    const onDimension = vi.fn(async () => {});
    const result = probeDimensions({ urls: ['a'], signal: controller.signal, probe, onDimension, onProgress: vi.fn() });
    const assertion = expect(result).rejects.toThrow();
    controller.abort(); complete({ width: 1, height: 1 });
    await assertion;
    expect(onDimension).not.toHaveBeenCalled();
  });
  it('releases image listeners and requests after timeout or Stop', async () => {
    vi.useFakeTimers();
    const images: any[] = [];
    vi.stubGlobal('Image', class {
      src = ''; onload = null; onerror = null; removeAttribute = vi.fn();
      constructor() { images.push(this); }
    });
    const first = probeImageDimensions('a.jpg', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(IMAGE_PROBE_TIMEOUT_MS);
    expect(await first).toBeNull();
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
    const controller = new AbortController();
    const second = probeImageDimensions('b.jpg', controller.signal);
    controller.abort();
    expect(await second).toBeNull();
    expect(images[1].onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('installs no timers or network requests merely by initializing optional tools', () => {
    vi.useFakeTimers();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    createScanToolsController({ getEpoch: () => 1, largeDataUrlStore: new Map() });
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts active page work and removes every timer when its owning port disconnects', async () => {
    vi.useFakeTimers();
    const images: any[] = [];
    vi.stubGlobal('Image', class {
      src = ''; onload = null; onerror = null; removeAttribute = vi.fn();
      constructor() { images.push(this); }
    });
    const sendMessage = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    vi.stubGlobal('window', { location: { href: 'https://example.com' },
      addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let run!: (message: unknown) => void;
    let disconnect!: () => void;
    const port = { postMessage: vi.fn(),
      onMessage: { addListener: (listener: typeof run) => { run = listener; } },
      onDisconnect: { addListener: (listener: typeof disconnect) => { disconnect = listener; } } };
    const tools = createScanToolsController({ getEpoch: () => 1, largeDataUrlStore: new Map() });
    tools.attach(port as any);
    expect(images).toHaveLength(0);
    run({ type: 'RUN_SCAN_TOOL', tool: 'dimensions', scanEpoch: 1, pageUrl: 'https://example.com',
      urls: ['https://cdn.example/photo.jpg'], orderStart: 0 });
    expect(images).toHaveLength(1);
    disconnect(); await vi.advanceTimersByTimeAsync(0);
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: expect.objectContaining({ status: 'stopped' }),
    }));
  });
});

describe('optional scrolling', () => {
  function viewport() {
    vi.useFakeTimers();
    const listeners = new Map<string, (...args: any[]) => void>();
    const page = { scrollingElement: { scrollHeight: 2000 } };
    const win = { scrollX: 10, scrollY: 150, innerHeight: 500,
      scrollTo: vi.fn((position: { top: number }) => { win.scrollY = Math.min(page.scrollingElement.scrollHeight - win.innerHeight, position.top); }),
      addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
      removeEventListener: vi.fn((name) => listeners.delete(name)) };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', page);
    return { win, listeners, page };
  }
  it('reaches the bottom of a forty-viewport page within 2.5 seconds instead of pausing at every image', async () => {
    const { win, page } = viewport();
    page.scrollingElement.scrollHeight = 20_500;
    const completed = vi.fn();
    const result = scrollPage(new AbortController().signal, vi.fn()).then(completed);
    await vi.advanceTimersByTimeAsync(2500);
    expect(win.scrollY).toBe(20_000);
    expect(completed).not.toHaveBeenCalled(); // Bottom settling still waits for asynchronously appended content.
    await vi.runAllTimersAsync(); await result;
    expect(completed).toHaveBeenCalledOnce();
    expect(win.scrollY).toBe(150);
  });
  it('resumes the fast sweep when delayed content extends the bottom of the page', async () => {
    const { win, page } = viewport();
    const completed = vi.fn();
    const result = scrollPage(new AbortController().signal, vi.fn()).then(completed);
    await vi.advanceTimersByTimeAsync(400);
    expect(win.scrollY).toBe(1500);
    page.scrollingElement.scrollHeight = 5000;
    await vi.advanceTimersByTimeAsync(1200);
    expect(win.scrollY).toBe(4500);
    expect(completed).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); await result;
    expect(win.scrollY).toBe(150);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for a stable bottom and restores the starting position on completion', async () => {
    const { win, listeners } = viewport();
    const progress = vi.fn();
    const result = scrollPage(new AbortController().signal, progress);
    await vi.runAllTimersAsync(); await result;
    expect(progress.mock.calls.length).toBeGreaterThan(4);
    expect(win.scrollTo).toHaveBeenLastCalledWith({ left: 10, top: 150, behavior: 'instant' });
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('restores on Stop and respects a user manually taking over scrolling', async () => {
    const { win, listeners } = viewport();
    const controller = new AbortController();
    const result = scrollPage(controller.signal, vi.fn());
    const assertion = expect(result).rejects.toThrow();
    controller.abort(); await assertion;
    expect(win.scrollY).toBe(150);
    const manual = scrollPage(new AbortController().signal, vi.fn());
    const manualAssertion = expect(manual).rejects.toThrow();
    win.scrollY = 333; listeners.get('wheel')!(); await manualAssertion;
    expect(win.scrollY).toBe(333);
  });
});

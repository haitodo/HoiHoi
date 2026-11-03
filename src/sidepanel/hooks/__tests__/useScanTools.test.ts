import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PORT_NAMES } from '@shared/constants';

const host = vi.hoisted(() => ({ value: null as any, cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({
  useState: (value: any) => { host.value = value; return [value, (next: any) => { host.value = typeof next === 'function' ? next(host.value) : next; }]; },
  useRef: (value: any) => ({ current: value }), useCallback: (callback: any) => callback,
  useEffect: (effect: () => () => void) => { host.cleanup = effect(); },
}));
import { useScanTools } from '../useScanTools';

function event() {
  const listeners: Array<(...args: any[]) => void> = [];
  return { addListener: (listener: (...args: any[]) => void) => listeners.push(listener),
    emit: (...args: any[]) => listeners.forEach((listener) => listener(...args)) };
}

describe('optional scan tool controls', () => {
  let port: { onMessage: ReturnType<typeof event>; onDisconnect: ReturnType<typeof event>;
    disconnect: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    port = { onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn(() => port.onDisconnect.emit()) };
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } });
  });
  afterEach(() => { host.cleanup?.(); vi.unstubAllGlobals(); });
  const options = { tabId: 1, scanEpoch: 1, pageUrl: 'https://example.com', enabled: true };
  it('creates no connection on normal scans and starts exactly one explicit run', () => {
    const controls = useScanTools(options);
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
    controls.start('dimensions'); controls.start('scroll');
    expect(chrome.runtime.connect).toHaveBeenCalledExactlyOnceWith({ name: PORT_NAMES.SCAN_TOOLS });
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'START_SCAN_TOOL', tabId: 1, scanEpoch: 1, tool: 'dimensions' });
    controls.stop(); expect(port.disconnect).toHaveBeenCalledOnce();
    expect(host.value.status).toBe('stopped');
  });
  it('closes the run on unmount/context change and ignores late results', () => {
    const controls = useScanTools(options); controls.start('pages');
    host.cleanup?.();
    expect(port.disconnect).toHaveBeenCalledOnce();
    const previous = host.value;
    port.onMessage.emit({ type: 'SCAN_TOOL_PROGRESS', progress: { status: 'completed' } });
    expect(host.value).toBe(previous);
  });
  it('preserves successful completion when the port disconnects and never auto-restarts', () => {
    const controls = useScanTools(options); controls.start('scroll');
    port.onMessage.emit({ type: 'SCAN_TOOL_PROGRESS', progress: { status: 'completed', tool: 'scroll', current: 10, message: 'done' } });
    expect(host.value.status).toBe('completed'); expect(port.disconnect).toHaveBeenCalledOnce();
    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
  });
  it('does not start tasks when the panel is hidden or the page is unavailable', () => {
    useScanTools({ ...options, enabled: false }).start('scroll');
    expect(chrome.runtime.connect).not.toHaveBeenCalled();
  });
});

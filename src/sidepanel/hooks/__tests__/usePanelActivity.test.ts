import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSessionSnapshot } from '@shared/types';
import { PORT_NAMES } from '@shared/constants';

// Effects/refs only: a small hook host avoids needing a DOM or another React runtime dependency.
const host = vi.hoisted(() => ({ slots: [] as any[], index: 0, pending: [] as Array<() => void> }));
vi.mock('react', () => ({
  useState(initial: any) {
    const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [host.slots[index], (value: any) => {
      host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value;
    }];
  },
  useRef(initial: any) {
    const index = host.index++;
    return host.slots[index] ??= { current: initial };
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = host.index++;
    const previous = host.slots[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    host.pending.push(() => {
      previous?.cleanup?.();
      host.slots[index] = { deps, cleanup: effect() };
    });
  },
}));
import { usePanelActivity } from '../usePanelActivity';

function event() {
  const listeners = new Set<(...args: any[]) => unknown>();
  return { addListener: (listener: (...args: any[]) => unknown) => listeners.add(listener),
    removeListener: (listener: (...args: any[]) => unknown) => listeners.delete(listener),
    emit: (...args: any[]) => [...listeners].forEach((listener) => listener(...args)) };
}
function port(name: string) {
  return { name, postMessage: vi.fn(), onDisconnect: event(), disconnect: vi.fn() };
}
function snapshot(tabId: number, scanStatus: TabSessionSnapshot['scanStatus'] = 'watching', scanEpoch = 1): TabSessionSnapshot {
  return { tabId, scanStatus, scanEpoch, revision: 1, items: [], videos: [], selectedIds: [], selectedVideoIds: [], downloads: {} };
}

describe('panel observation lifecycle', () => {
  let messages: ReturnType<typeof event>;
  let visibility: () => void;
  let documentState: { visibilityState: string };
  let backgrounds: ReturnType<typeof port>[];
  let contents: ReturnType<typeof port>[];

  beforeEach(() => {
    host.slots = []; host.index = 0; host.pending = [];
    messages = event(); backgrounds = []; contents = [];
    documentState = { visibilityState: 'visible' };
    vi.stubGlobal('document', Object.assign(documentState, {
      addEventListener: (_: string, listener: () => void) => { visibility = listener; },
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal('chrome', {
      runtime: { onMessage: messages, connect: ({ name }: { name: string }) => {
        const next = port(name); backgrounds.push(next); return next;
      } },
      tabs: { connect: (_: number, { name }: { name: string }) => {
        const next = port(name); contents.push(next); return next;
      } },
    });
  });
  afterEach(() => { host.slots.forEach((slot) => slot?.cleanup?.()); vi.unstubAllGlobals(); });

  function render(tabId: number, value: TabSessionSnapshot | null) {
    host.index = 0;
    const visible = usePanelActivity(tabId, value);
    const pending = host.pending.splice(0);
    pending.forEach((effect) => effect());
    return visible;
  }

  it('does not connect to an unscanned tab or reuse the previous tab snapshot', () => {
    render(10, snapshot(10, 'unscanned'));
    expect(contents).toHaveLength(0);
    render(10, snapshot(10));
    expect(contents[0]?.name).toBe(PORT_NAMES.SCANNER_LIFECYCLE);
    render(20, snapshot(10));
    expect(contents[0]?.disconnect).toHaveBeenCalledOnce();
    expect(contents).toHaveLength(1);
    expect(backgrounds[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'PANEL_WATCH_TAB', tabId: 20 });
  });

  it('disconnects both observers while the panel is hidden and restores them on visibility', () => {
    const value = snapshot(10);
    render(10, value);
    documentState.visibilityState = 'hidden'; visibility(); render(10, value);
    expect(backgrounds[0]?.disconnect).toHaveBeenCalledOnce();
    expect(contents[0]?.disconnect).toHaveBeenCalledOnce();
    documentState.visibilityState = 'visible'; visibility(); render(10, value);
    expect(backgrounds).toHaveLength(2);
    expect(contents).toHaveLength(2);
  });

  it('allows the worker to sleep without reconnecting or disturbing the page connection', () => {
    const value = snapshot(10);
    render(10, value);
    backgrounds[0]?.onDisconnect.emit();
    render(10, value);
    expect(backgrounds).toHaveLength(1);
    messages.emit({ type: 'HOIHOI_BACKGROUND_READY' }); render(10, value);
    expect(backgrounds).toHaveLength(2);
    expect(contents).toHaveLength(1);
    expect(contents[0]?.disconnect).not.toHaveBeenCalled();
  });

  it('updates scan epochs without repeatedly disconnecting and rescanning the page', () => {
    render(10, snapshot(10));
    render(10, snapshot(10, 'scanning', 2));
    expect(contents).toHaveLength(1);
    expect(contents[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'SCANNER_WATCH', scanEpoch: 2 });
  });

  it('retries a missing content receiver once injection is ready', () => {
    const value = snapshot(10, 'scanning');
    render(10, value);
    contents[0]?.onDisconnect.emit();
    messages.emit({ type: 'HOIHOI_SCANNER_READY', tabId: 10 }); render(10, value);
    expect(contents).toHaveLength(2);
  });
});

// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundToPanelEvent, MessageResult } from '@shared/messages';
import type { TabSessionSnapshot } from '@shared/types';
import { useTabSession } from '../useTabSession';

function createSnapshot(overrides: Partial<TabSessionSnapshot> = {}): TabSessionSnapshot {
  return {
    tabId: 10,
    revision: 1,
    scanEpoch: 1,
    scanStatus: 'scanning',
    pageUrl: 'https://www.xasiat.com/albums/16178/photobook-comfy-climate/',
    items: [],
    videos: [],
    selectedIds: [],
    selectedVideoIds: [],
    downloads: {},
    ...overrides,
  };
}

describe('useTabSession', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useTabSession> | null = null;
  let listeners: Set<(msg: unknown) => void>;
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    listeners = new Set();
    sendMessageMock = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-ext',
        sendMessage: sendMessageMock,
        onMessage: {
          addListener: (fn: (msg: unknown) => void) => listeners.add(fn),
          removeListener: (fn: (msg: unknown) => void) => listeners.delete(fn),
        },
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function Harness({ tabId }: { tabId: number | null }) {
    latest = useTabSession(tabId);
    return null;
  }

  function emitEvent(event: BackgroundToPanelEvent) {
    act(() => {
      for (const listener of listeners) {
        listener(event);
      }
    });
  }

  it('refetches instead of freezing at scanning when delta events arrive before initial snapshot resolves', async () => {
    let resolveFirst!: (res: MessageResult<TabSessionSnapshot>) => void;
    const staleSnapshot = createSnapshot({ revision: 1, scanStatus: 'scanning' });
    const latestSnapshot = createSnapshot({ revision: 3, scanStatus: 'watching' });

    sendMessageMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: latestSnapshot });

    act(() => root.render(<Harness tabId={10} />));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // Scan finishes and emits delta events before the first PANEL_GET_TAB_SESSION resolves.
    emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SCAN_STATUS_CHANGED',
      tabId: 10,
      revision: 3,
      scanStatus: 'watching',
    });

    await act(async () => {
      resolveFirst({ ok: true, data: staleSnapshot });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(latest?.snapshot?.revision).toBe(3);
    expect(latest?.snapshot?.scanStatus).toBe('watching');
  });

  it('queues a self-heal refetch when a revision gap occurs during an in-flight snapshot fetch', async () => {
    let resolveFirst!: (res: MessageResult<TabSessionSnapshot>) => void;
    const scanningSnapshot = createSnapshot({ revision: 1, scanStatus: 'scanning' });
    const watchingSnapshot = createSnapshot({ revision: 3, scanStatus: 'watching' });

    sendMessageMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: watchingSnapshot });

    act(() => root.render(<Harness tabId={10} />));

    emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SESSION_REPLACED',
      tabId: 10,
      snapshot: scanningSnapshot,
    });

    // Missed revision 2, then revision 3 arrives while the initial fetch is still in flight.
    emitEvent({
      channel: 'WIC_BG_TO_PANEL',
      type: 'EVENT_SCAN_STATUS_CHANGED',
      tabId: 10,
      revision: 3,
      scanStatus: 'watching',
    });

    await act(async () => {
      resolveFirst({ ok: true, data: scanningSnapshot });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(latest?.snapshot?.revision).toBe(3);
    expect(latest?.snapshot?.scanStatus).toBe('watching');
  });
});

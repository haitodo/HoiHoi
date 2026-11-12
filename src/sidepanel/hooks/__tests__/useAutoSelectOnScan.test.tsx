// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSelectOnScan, type UseAutoSelectOnScanOptions } from '../useAutoSelectOnScan';

interface TestItem {
  itemId: string;
}

describe('useAutoSelectOnScan', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSelectItemsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onSelectItemsMock = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function HookTester(props: UseAutoSelectOnScanOptions<TestItem>) {
    useAutoSelectOnScan(props);
    return null;
  }

  function renderHook(props: Partial<UseAutoSelectOnScanOptions<TestItem>>) {
    const fullProps: UseAutoSelectOnScanOptions<TestItem> = {
      enabled: true,
      mediaMode: 'image',
      tabId: 1,
      scanEpoch: 1,
      scanStatus: 'watching',
      items: [],
      selectedIds: new Set<string>(),
      onSelectItems: onSelectItemsMock,
      ...props,
    };
    act(() => root.render(<HookTester {...fullProps} />));
  }

  it('automatically selects new images on initial scan when enabled', () => {
    const items = [{ itemId: 'item_1' }, { itemId: 'item_2' }, { itemId: 'item_3' }];
    renderHook({ items, selectedIds: new Set() });

    expect(onSelectItemsMock).toHaveBeenCalledOnce();
    expect(onSelectItemsMock).toHaveBeenCalledWith(['item_1', 'item_2', 'item_3'], 'image');
  });

  it('does not select images when enabled is false', () => {
    const items = [{ itemId: 'item_1' }, { itemId: 'item_2' }];
    renderHook({ enabled: false, items, selectedIds: new Set() });

    expect(onSelectItemsMock).not.toHaveBeenCalled();
  });

  it('does not select images in video mode', () => {
    const items = [{ itemId: 'vid_1' }, { itemId: 'vid_2' }];
    renderHook({ mediaMode: 'video', items, selectedIds: new Set() });

    expect(onSelectItemsMock).not.toHaveBeenCalled();
  });

  it('does not select images when scanStatus is restricted or unscanned or stale', () => {
    const items = [{ itemId: 'item_1' }];
    renderHook({ scanStatus: 'restricted', items });
    expect(onSelectItemsMock).not.toHaveBeenCalled();

    renderHook({ scanStatus: 'unscanned', items });
    expect(onSelectItemsMock).not.toHaveBeenCalled();

    renderHook({ scanStatus: 'stale', items });
    expect(onSelectItemsMock).not.toHaveBeenCalled();
  });

  it('selects only newly arrived items when scanning in batches without re-selecting unselected items', () => {
    const batch1 = [{ itemId: 'item_1' }, { itemId: 'item_2' }];
    renderHook({ items: batch1, selectedIds: new Set() });

    expect(onSelectItemsMock).toHaveBeenCalledWith(['item_1', 'item_2'], 'image');
    onSelectItemsMock.mockClear();

    // User unchecks item_1, so selectedIds only has item_2
    const selectedIds = new Set(['item_2']);
    // Batch 2 arrives with item_3
    const batch2 = [{ itemId: 'item_1' }, { itemId: 'item_2' }, { itemId: 'item_3' }];
    renderHook({ items: batch2, selectedIds });

    // Only item_3 should be selected. item_1 (which user unchecked) MUST NOT be re-selected!
    expect(onSelectItemsMock).toHaveBeenCalledOnce();
    expect(onSelectItemsMock).toHaveBeenCalledWith(['item_3'], 'image');
  });

  it('respects existing selections when opening a session that already has selected items', () => {
    const items = [{ itemId: 'item_1' }, { itemId: 'item_2' }];
    const existingSelectedIds = new Set(['item_1']);

    // Component mounts for a tab session that already has user selections
    renderHook({ items, selectedIds: existingSelectedIds });

    expect(onSelectItemsMock).not.toHaveBeenCalled();
  });

  it('resets tracking and auto-selects on rescan (scanEpoch change)', () => {
    const itemsEpoch1 = [{ itemId: 'item_1' }];
    renderHook({ scanEpoch: 1, items: itemsEpoch1, selectedIds: new Set() });
    expect(onSelectItemsMock).toHaveBeenCalledWith(['item_1'], 'image');
    onSelectItemsMock.mockClear();

    // User triggers rescan -> scanEpoch bumps to 2, items reset then re-populate
    const itemsEpoch2 = [{ itemId: 'item_1' }, { itemId: 'item_2' }];
    renderHook({ scanEpoch: 2, items: itemsEpoch2, selectedIds: new Set() });

    expect(onSelectItemsMock).toHaveBeenCalledOnce();
    expect(onSelectItemsMock).toHaveBeenCalledWith(['item_1', 'item_2'], 'image');
  });
});

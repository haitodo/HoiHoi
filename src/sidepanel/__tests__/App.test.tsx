// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageItem, TabSessionSnapshot, VideoItem, VideoVariant } from '@shared/types';
import { App } from '../App';

const panel = vi.hoisted(() => ({
  snapshot: null as TabSessionSnapshot | null,
  triggerRescan: vi.fn(),
  toggleSelection: vi.fn(),
  selectAllVisible: vi.fn(),
  deselectVisible: vi.fn(),
}));

vi.mock('../hooks/useActiveTabId', () => ({
  useActiveTabId: () => ({ activeTabId: panel.snapshot?.tabId ?? null, isPinned: false }),
}));
vi.mock('../hooks/useTabSession', () => ({ useTabSession: () => panel }));
vi.mock('../hooks/usePanelActivity', () => ({ usePanelActivity: () => true }));
vi.mock('../hooks/useBlobStreamBridge', () => ({ useBlobStreamBridge: () => {} }));

// Happy DOM has no measured viewport. Render all rows so the real cards can receive clicks.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 200,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 200 })),
    measureElement: () => {},
  }),
}));

function image(order: number, name: string, width: number | null): ImageItem {
  const url = `https://example.com/${name}.jpg`;
  return {
    itemId: `item_${order}`,
    primaryUrl: url,
    selectedUrl: url,
    variants: [{ url, roles: ['src'], descriptors: [], format: 'jpeg', naturalWidth: width, naturalHeight: width }],
    sources: ['img'],
    occurrenceCount: 1,
    firstSeenOrder: order,
  };
}

function video(order: number, filename: string, durationSec: number | null, variant: Partial<VideoVariant> = {}): VideoItem {
  const url = `https://example.com/${filename}`;
  return {
    itemId: `vid_${order}`,
    primaryUrl: url,
    selectedUrl: url,
    durationSec,
    variants: [{
      url,
      format: 'mp4',
      deliveryType: 'direct',
      readiness: 'ready',
      roles: ['src'],
      descriptors: [],
      videoWidth: null,
      videoHeight: null,
      fileSizeBytes: null,
      ...variant,
    }],
    sources: ['video-element'],
    occurrenceCount: 1,
    firstSeenOrder: order,
  };
}

describe('side panel media views', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function render(overrides: Partial<TabSessionSnapshot>) {
    panel.snapshot = {
      tabId: 1,
      revision: 1,
      scanEpoch: 1,
      scanStatus: 'watching',
      items: [],
      videos: [],
      selectedIds: [],
      selectedVideoIds: [],
      downloads: {},
      ...overrides,
    };
    act(() => root.render(<App />));
  }

  function clickButton(text: string, selector = 'button') {
    const button = [...container.querySelectorAll<HTMLButtonElement>(selector)]
      .find((candidate) => candidate.textContent?.includes(text));
    expect(button).toBeDefined();
    act(() => button!.click());
  }

  it('can request a rescan while the panel is still searching for images', () => {
    render({ scanStatus: 'scanning' });
    expect(container.textContent).toContain('画像を探しています...');
    clickButton('再スキャン');
    expect(panel.triggerRescan).toHaveBeenCalledOnce();

    render({ scanStatus: 'restricted' });
    clickButton('再スキャン');
    expect(panel.triggerRescan).toHaveBeenCalledOnce();
  });

  it('loads saved image filters, keeps hidden selections, and only clears the visible selection', () => {
    localStorage.setItem('wic_filter_preferences', JSON.stringify({
      minWidth: 600, minHeight: null, formats: ['jpeg'], includeUnknownDimensions: false,
      urlQuery: 'a previous search',
    }));
    localStorage.setItem('wic_sort_order', 'filename_asc');
    const images = [image(1, 'small', 300), image(2, 'frame10', 800), image(3, 'frame1', null), image(4, 'frame2', 800)];
    render({ items: images, selectedIds: ['item_1', 'item_2'] });

    const visibleImages = () => [...container.querySelectorAll<HTMLImageElement>('img[src^="https://example.com/"]')]
      .map((img) => img.src);
    expect(visibleImages()).toEqual([images[3]!.selectedUrl, images[1]!.selectedUrl]);
    expect(container.textContent).toContain('非表示 1件');
    expect(container.textContent).toContain('寸法不明のため判定できない画像: 1件');

    clickButton('表示中を解除');
    expect(panel.deselectVisible).toHaveBeenCalledWith(['item_2'], 'image');

    act(() => container.querySelector<HTMLInputElement>('label input[type="checkbox"]')!.click());
    expect(visibleImages()).toEqual([images[2]!.selectedUrl, images[3]!.selectedUrl, images[1]!.selectedUrl]);
    expect(JSON.parse(localStorage.getItem('wic_filter_preferences')!)).toEqual({
      minWidth: 600, minHeight: null, formats: ['jpeg'], includeUnknownDimensions: true,
    });
  });

  it('keeps the video duration boundaries and sorts resolution hints before unknown values', () => {
    localStorage.setItem('wic_media_mode', 'video');
    localStorage.setItem('wic_video_filter_preferences', JSON.stringify({ durationRange: 'medium' }));
    localStorage.setItem('wic_video_sort_order', 'resolution_desc');
    render({ videos: [
      video(1, 'low.mp4', 60, { videoWidth: 640, videoHeight: 480 }),
      video(2, 'descriptor-360p.mp4', 120, { descriptors: ['1080p'] }),
      video(3, 'in-url-1080p.mp4', 600),
      video(4, 'unknown-resolution.mp4', 120),
      video(5, 'unknown-duration.mp4', null),
      video(6, 'too-long.mp4', 601),
    ] });

    const visibleNames = () => [...container.querySelectorAll('[title^="https://example.com/"]')]
      .map((node) => node.textContent);
    expect(visibleNames()).toEqual(['descriptor-360p.mp4', 'in-url-1080p.mp4', 'low.mp4', 'unknown-resolution.mp4']);
    expect(container.textContent).toContain('画質・長さ未取得の動画が 1 件非表示です');

    const sort = container.querySelector<HTMLOptionElement>('option[value="resolution_asc"]')!.closest('select')!;
    act(() => {
      sort.value = 'resolution_asc';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(visibleNames()).toEqual(['low.mp4', 'descriptor-360p.mp4', 'in-url-1080p.mp4', 'unknown-resolution.mp4']);
    expect(localStorage.getItem('wic_video_sort_order')).toBe('resolution_asc');
  });

  it('selects only ready videos in display order and resets the Shift anchor on mode and tab changes', () => {
    localStorage.setItem('wic_media_mode', 'video');
    localStorage.setItem('wic_video_sort_order', 'position_desc');
    const videos = [
      video(1, 'first.mp4', 20),
      video(2, 'stream.m3u8', 20, { readiness: 'stream_manifest', deliveryType: 'adaptive_hls', format: 'hls' }),
      video(3, 'last.mp4', 20),
    ];
    render({ videos });

    function clickVideoCheckbox(index: number, shiftKey = false) {
      const checkbox = container.querySelectorAll<HTMLInputElement>('input[title="ダウンロード対象として選択"]')[index];
      expect(checkbox).toBeDefined();
      act(() => checkbox!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey })));
    }

    clickButton('表示中を全選択 (2件)');
    clickVideoCheckbox(1);
    expect(panel.toggleSelection).toHaveBeenLastCalledWith('vid_1', 'video');
    clickVideoCheckbox(0, true);
    expect(panel.selectAllVisible.mock.calls).toEqual([
      [['vid_3', 'vid_1'], 'video'],
      [['vid_3', 'vid_1'], 'video'],
    ]);

    clickButton('画像', '[role="tab"]');
    clickButton('動画', '[role="tab"]');
    clickVideoCheckbox(1, true);
    expect(panel.toggleSelection).toHaveBeenLastCalledWith('vid_1', 'video');

    render({ tabId: 2, videos });
    clickVideoCheckbox(0, true);
    expect(panel.toggleSelection.mock.calls).toEqual([
      ['vid_1', 'video'], ['vid_1', 'video'], ['vid_3', 'video'],
    ]);
    expect(panel.selectAllVisible).toHaveBeenCalledTimes(2);
  });
});

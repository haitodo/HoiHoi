// @vitest-environment happy-dom
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSessionSnapshot } from '@shared/types';
import { ScanTools } from '../ScanTools';

const mockUseScanTools = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  progress: null as any,
  running: false,
}));

vi.mock('../../hooks/useScanTools', () => ({
  useScanTools: () => mockUseScanTools,
}));

describe('ScanTools component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockUseScanTools.start.mockReset();
    mockUseScanTools.stop.mockReset();
    mockUseScanTools.progress = null;
    mockUseScanTools.running = false;
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  const createDummySnapshot = (overrides?: Partial<TabSessionSnapshot>): TabSessionSnapshot => ({
    tabId: 1,
    revision: 1,
    scanEpoch: 1,
    domain: 'example.com',
    pageUrl: 'https://example.com/gallery/1',
    pageTitle: 'Test Gallery',
    scanStatus: 'watching',
    items: [
      {
        itemId: 'img1',
        primaryUrl: 'https://example.com/img1.jpg',
        selectedUrl: 'https://example.com/img1.jpg',
        variants: [
          {
            url: 'https://example.com/img1.jpg',
            roles: ['src'],
            descriptors: [],
            format: 'jpeg',
            naturalWidth: null,
            naturalHeight: null,
          },
        ],
        sources: ['img'],
        occurrenceCount: 1,
        firstSeenOrder: 1,
      },
    ],
    videos: [],
    selectedIds: [],
    selectedVideoIds: [],
    downloads: {},
    ...overrides,
  });

  it('renders quick action buttons directly without details toggle', () => {
    const snapshot = createDummySnapshot();
    const root = createRoot(container);
    act(() => {
      root.render(<ScanTools snapshot={snapshot} enabled={true} />);
    });

    expect(container.querySelector('details')).toBeNull();
    const toolbar = container.querySelector('.scan-toolbar');
    expect(toolbar).not.toBeNull();

    const buttons = container.querySelectorAll('.scan-action-btn');
    expect(buttons.length).toBe(3);

    const btn0 = buttons[0] as HTMLButtonElement;
    const btn1 = buttons[1] as HTMLButtonElement;
    const btn2 = buttons[2] as HTMLButtonElement;

    // 1st button: dimensions (unknown = 1)
    expect(btn0.textContent).toContain('寸法取得');
    expect(btn0.textContent).toContain('1');
    expect(btn0.classList.contains('has-highlight')).toBe(true);

    // 2nd button: scroll
    expect(btn1.textContent).toContain('スクロール');

    // 3rd button: pages
    expect(btn2.textContent).toContain('次ページ収集');
  });

  it('triggers dimension scan when clicking the dimensions button', () => {
    const snapshot = createDummySnapshot();
    const root = createRoot(container);
    act(() => {
      root.render(<ScanTools snapshot={snapshot} enabled={true} />);
    });

    const buttons = container.querySelectorAll('.scan-action-btn');
    const btn0 = buttons[0] as HTMLButtonElement;
    act(() => {
      btn0.click();
    });

    expect(mockUseScanTools.start).toHaveBeenCalledWith('dimensions');
  });

  it('shows dimensions as acquired when all images have width/height', () => {
    const snapshot = createDummySnapshot({
      items: [
        {
          itemId: 'img1',
          primaryUrl: 'https://example.com/img1.jpg',
          selectedUrl: 'https://example.com/img1.jpg',
          variants: [
            {
              url: 'https://example.com/img1.jpg',
              roles: ['src'],
              descriptors: [],
              format: 'jpeg',
              naturalWidth: 800,
              naturalHeight: 600,
            },
          ],
          sources: ['img'],
          occurrenceCount: 1,
          firstSeenOrder: 1,
        },
      ],
    });
    const root = createRoot(container);
    act(() => {
      root.render(<ScanTools snapshot={snapshot} enabled={true} />);
    });

    const buttons = container.querySelectorAll('.scan-action-btn');
    const btn0 = buttons[0] as HTMLButtonElement;
    expect(btn0.textContent).toContain('寸法取得済');
    expect(btn0.disabled).toBe(true);
  });

  it('renders running progress bar and stop button when a tool is running', () => {
    mockUseScanTools.running = true;
    mockUseScanTools.progress = {
      tool: 'scroll',
      status: 'running',
      current: 50,
      message: 'スクロール中... (50%)',
    };

    const snapshot = createDummySnapshot();
    const root = createRoot(container);
    act(() => {
      root.render(<ScanTools snapshot={snapshot} enabled={true} />);
    });

    expect(container.querySelector('.scan-running-bar')).not.toBeNull();
    expect(container.textContent).toContain('スクロール中... (50%)');

    const stopBtn = container.querySelector('.scan-stop-btn') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    act(() => {
      stopBtn.click();
    });
    expect(mockUseScanTools.stop).toHaveBeenCalled();
  });
});

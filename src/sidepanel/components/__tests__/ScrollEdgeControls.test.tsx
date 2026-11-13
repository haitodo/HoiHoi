// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollEdgeControls } from '../ScrollEdgeControls';

function setScrollMetrics(
  el: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
}

function TestHarness({
  clientHeight,
  scrollHeight,
  initialScrollTop = 0,
  onScrollEl,
}: {
  clientHeight: number;
  scrollHeight: number;
  initialScrollTop?: number;
  onScrollEl?: (el: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={(node) => {
          ref.current = node;
          if (node) {
            setScrollMetrics(node, {
              clientHeight,
              scrollHeight,
              scrollTop: initialScrollTop,
            });
            onScrollEl?.(node);
          }
        }}
      >
        <div style={{ height: `${scrollHeight}px` }} />
      </div>
      <ScrollEdgeControls scrollContainerRef={ref} contentHeight={scrollHeight} />
    </div>
  );
}

describe('ScrollEdgeControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hides controls when content fits without scrolling', () => {
    act(() => {
      root.render(<TestHarness clientHeight={500} scrollHeight={500} />);
    });
    expect(container.querySelector('.scroll-edge-controls')).toBeNull();
  });

  it('shows controls when scrollable and updates top/bottom disabled states on scroll', () => {
    let scrollEl!: HTMLDivElement;
    act(() => {
      root.render(
        <TestHarness
          clientHeight={400}
          scrollHeight={2000}
          initialScrollTop={0}
          onScrollEl={(el) => {
            scrollEl = el;
          }}
        />,
      );
    });

    const topBtn = container.querySelector<HTMLButtonElement>('button[aria-label="一番上へ移動"]')!;
    const bottomBtn = container.querySelector<HTMLButtonElement>('button[aria-label="一番下へ移動"]')!;
    expect(topBtn).not.toBeNull();
    expect(bottomBtn).not.toBeNull();
    expect(topBtn.disabled).toBe(true);
    expect(bottomBtn.disabled).toBe(false);

    // Scroll to middle
    act(() => {
      scrollEl.scrollTop = 600;
      scrollEl.dispatchEvent(new Event('scroll'));
    });
    expect(topBtn.disabled).toBe(false);
    expect(bottomBtn.disabled).toBe(false);

    // Scroll to bottom
    act(() => {
      scrollEl.scrollTop = 1600;
      scrollEl.dispatchEvent(new Event('scroll'));
    });
    expect(topBtn.disabled).toBe(false);
    expect(bottomBtn.disabled).toBe(true);
  });

  it('scrolls smoothly to top and bottom, and snaps to updated virtualized bottom if height grows', () => {
    let scrollEl!: HTMLDivElement;
    act(() => {
      root.render(
        <TestHarness
          clientHeight={400}
          scrollHeight={2000}
          initialScrollTop={500}
          onScrollEl={(el) => {
            scrollEl = el;
          }}
        />,
      );
    });

    const scrollToSpy = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options && typeof options.top === 'number') {
        scrollEl.scrollTop = options.top;
      }
    });
    scrollEl.scrollTo = scrollToSpy as unknown as typeof scrollEl.scrollTo;

    const topBtn = container.querySelector<HTMLButtonElement>('button[aria-label="一番上へ移動"]')!;
    const bottomBtn = container.querySelector<HTMLButtonElement>('button[aria-label="一番下へ移動"]')!;

    // Jump to top
    act(() => {
      topBtn.click();
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(scrollEl.scrollTop).toBe(0);

    // Jump to bottom while virtualized row measurement increases scrollHeight mid-scroll
    scrollToSpy.mockClear();
    act(() => {
      bottomBtn.click();
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1600, behavior: 'smooth' });

    act(() => {
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 2090, configurable: true });
      vi.advanceTimersByTime(200);
    });
    expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 1690, behavior: 'auto' });
    expect(scrollEl.scrollTop).toBe(1690);
  });

  it('cancels pending bottom snap when user manually scrolls via wheel', () => {
    let scrollEl!: HTMLDivElement;
    act(() => {
      root.render(
        <TestHarness
          clientHeight={400}
          scrollHeight={2000}
          initialScrollTop={0}
          onScrollEl={(el) => {
            scrollEl = el;
          }}
        />,
      );
    });

    const scrollToSpy = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options && typeof options.top === 'number') {
        scrollEl.scrollTop = options.top;
      }
    });
    scrollEl.scrollTo = scrollToSpy as unknown as typeof scrollEl.scrollTo;

    const bottomBtn = container.querySelector<HTMLButtonElement>('button[aria-label="一番下へ移動"]')!;
    act(() => {
      bottomBtn.click();
    });
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 2090, configurable: true });
      scrollEl.dispatchEvent(new Event('wheel'));
      vi.advanceTimersByTime(300);
    });

    // No follow-up auto snap should happen after user wheel input
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });
});

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ScrollEdgeControlsProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Total virtualized content height in pixels; re-evaluates scrollability on layout changes. */
  contentHeight: number;
}

interface ScrollEdgeState {
  isScrollable: boolean;
  isAtTop: boolean;
  isAtBottom: boolean;
}

const SCROLLABLE_THRESHOLD_PX = 4;
const EDGE_THRESHOLD_PX = 8;
const BOTTOM_SNAP_SETTLE_MS = 140;
const BOTTOM_SNAP_MAX_WAIT_MS = 1500;

function readScrollEdgeState(el: HTMLDivElement): ScrollEdgeState {
  const maxScrollTop = el.scrollHeight - el.clientHeight;
  if (maxScrollTop <= SCROLLABLE_THRESHOLD_PX) {
    return { isScrollable: false, isAtTop: true, isAtBottom: true };
  }
  return {
    isScrollable: true,
    isAtTop: el.scrollTop <= EDGE_THRESHOLD_PX,
    isAtBottom: el.scrollTop >= maxScrollTop - EDGE_THRESHOLD_PX,
  };
}

function scrollElementTo(el: HTMLDivElement, top: number, behavior: ScrollBehavior): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top, behavior });
  } else {
    el.scrollTop = top;
  }
}

function TopEdgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3H13M8 5.5V13.5M4.5 9L8 5.5L11.5 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BottomEdgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5V10.5M4.5 7L8 10.5L11.5 7M3 13H13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Floating bottom-left controls for jumping directly to the top or bottom of a scrollable grid.
 * Automatically hides when the list fits without vertical scrolling.
 */
export const ScrollEdgeControls: React.FC<ScrollEdgeControlsProps> = ({
  scrollContainerRef,
  contentHeight,
}) => {
  const [scrollState, setScrollState] = useState<ScrollEdgeState>({
    isScrollable: false,
    isAtTop: true,
    isAtBottom: true,
  });

  // Tracks an active "jump to bottom" so virtualized row measurements mid-scroll still reach the true end.
  const pendingBottomSnapRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const maxWaitTimerRef = useRef<number | null>(null);

  const clearBottomSnap = useCallback(() => {
    pendingBottomSnapRef.current = false;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (maxWaitTimerRef.current !== null) {
      window.clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const updateScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const next = readScrollEdgeState(el);
    setScrollState((prev) =>
      prev.isScrollable === next.isScrollable &&
      prev.isAtTop === next.isAtTop &&
      prev.isAtBottom === next.isAtBottom
        ? prev
        : next,
    );
  }, [scrollContainerRef]);

  const finalizeBottomSnap = useCallback(() => {
    if (!pendingBottomSnapRef.current) return;
    clearBottomSnap();
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScrollTop - el.scrollTop > 2) {
      scrollElementTo(el, maxScrollTop, 'auto');
    }
    updateScrollState();
  }, [clearBottomSnap, scrollContainerRef, updateScrollState]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    updateScrollState();

    const handleScroll = () => {
      updateScrollState();
      if (!pendingBottomSnapRef.current) return;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(finalizeBottomSnap, BOTTOM_SNAP_SETTLE_MS);
    };

    const cancelOnUserInput = () => {
      if (pendingBottomSnapRef.current) {
        clearBottomSnap();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('scrollend', finalizeBottomSnap);
    el.addEventListener('wheel', cancelOnUserInput, { passive: true });
    el.addEventListener('touchstart', cancelOnUserInput, { passive: true });
    el.addEventListener('pointerdown', cancelOnUserInput, { passive: true });

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateScrollState);
      observer.observe(el);
      if (el.firstElementChild) {
        observer.observe(el.firstElementChild);
      }
    }

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('scrollend', finalizeBottomSnap);
      el.removeEventListener('wheel', cancelOnUserInput);
      el.removeEventListener('touchstart', cancelOnUserInput);
      el.removeEventListener('pointerdown', cancelOnUserInput);
      observer?.disconnect();
      clearBottomSnap();
    };
  }, [scrollContainerRef, contentHeight, updateScrollState, finalizeBottomSnap, clearBottomSnap]);

  if (!scrollState.isScrollable) {
    return null;
  }

  const handleScrollToTop = () => {
    clearBottomSnap();
    const el = scrollContainerRef.current;
    if (!el) return;
    scrollElementTo(el, 0, 'smooth');
    updateScrollState();
  };

  const handleScrollToBottom = () => {
    clearBottomSnap();
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    pendingBottomSnapRef.current = true;
    settleTimerRef.current = window.setTimeout(finalizeBottomSnap, BOTTOM_SNAP_SETTLE_MS);
    maxWaitTimerRef.current = window.setTimeout(clearBottomSnap, BOTTOM_SNAP_MAX_WAIT_MS);
    scrollElementTo(el, maxScrollTop, 'smooth');
    updateScrollState();
  };

  return (
    <div className="scroll-edge-controls" role="group" aria-label="一覧スクロール移動">
      <button
        type="button"
        className="scroll-edge-btn"
        onClick={handleScrollToTop}
        disabled={scrollState.isAtTop}
        aria-label="一番上へ移動"
        title="一番上へ移動"
      >
        <TopEdgeIcon />
      </button>
      <button
        type="button"
        className="scroll-edge-btn"
        onClick={handleScrollToBottom}
        disabled={scrollState.isAtBottom}
        aria-label="一番下へ移動"
        title="一番下へ移動"
      >
        <BottomEdgeIcon />
      </button>
    </div>
  );
};

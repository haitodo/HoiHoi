import { useCallback, useEffect, useRef, useState } from 'react';
import { isBgToPanelEvent } from '@shared/messages';

export interface UseActiveTabIdResult {
  activeTabId: number | null;
  isPinned: boolean;
  togglePin: () => void;
}

const PIN_STORAGE_KEY = 'wic_tab_pinned';

/**
 * Robustly tracks the active tab ID from within Side Panel.
 *
 * CRITICAL REQUIREMENTS:
 * 1. Restricted strictly to the window hosting this Side Panel (currentWindowId).
 *    Never tracks tabs or focus changes from other browser windows (e.g. separate video windows).
 * 2. Supports pinning to the current tab so the user can switch tabs or windows without losing their selection view.
 * 3. Handles tab closure gracefully (unpins and falls back to active tab in current window).
 * 4. Responds to explicit action clicks on tabs (via EVENT_ACTION_CLICKED).
 */
export function useActiveTabId(): UseActiveTabIdResult {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [isPinned, setIsPinnedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const isPinnedRef = useRef(isPinned);
  isPinnedRef.current = isPinned;

  const currentWindowIdRef = useRef<number | null>(null);
  const activeTabIdRef = useRef<number | null>(null);
  activeTabIdRef.current = activeTabId;

  const togglePin = useCallback(() => {
    setIsPinnedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PIN_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function resolveActiveTab(winId?: number) {
      try {
        const targetWinId = winId ?? currentWindowIdRef.current;
        if (targetWinId !== null && targetWinId !== undefined) {
          const tabs = await chrome.tabs.query({ active: true, windowId: targetWinId });
          if (isMounted && tabs[0]?.id !== undefined) {
            setActiveTabId(tabs[0].id);
            return;
          }
        }

        // Fallback if windowId is not yet resolved: query currentWindow: true
        const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isMounted && currentTabs[0]?.id !== undefined) {
          setActiveTabId(currentTabs[0].id);
        }
      } catch (err) {
        console.warn('[WIC] Failed to resolve active tab in window:', err);
      }
    }

    async function init() {
      try {
        const win = await chrome.windows.getCurrent();
        if (!isMounted) return;
        if (win?.id !== undefined) {
          currentWindowIdRef.current = win.id;
        }
        await resolveActiveTab(win?.id);
      } catch (err) {
        console.warn('[WIC] Failed to get current window:', err);
        await resolveActiveTab();
      }
    }

    void init();

    // Listen for tab switching within the browser
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (!isMounted) return;
      const winId = currentWindowIdRef.current;
      // Strictly ignore activations in other windows!
      if (winId !== null && activeInfo.windowId !== winId) {
        return;
      }
      // If pinned to a specific tab, do NOT follow active tab changes
      if (isPinnedRef.current) {
        return;
      }
      setActiveTabId(activeInfo.tabId);
    };

    // Listen for window focus changes
    const handleWindowFocusChanged = (focusedWindowId: number) => {
      if (!isMounted) return;
      const winId = currentWindowIdRef.current;
      // If focus changed to another window (or WINDOW_ID_NONE), DO NOT change activeTabId!
      // This ensures separate browser windows (e.g. video player) never steal Side Panel target.
      if (winId !== null && focusedWindowId !== winId) {
        return;
      }
      // Only when focus returns to our window and we are not pinned, refresh active tab
      if (!isPinnedRef.current && winId !== null) {
        void resolveActiveTab(winId);
      }
    };

    // Listen for tab closure
    const handleTabRemoved = (removedTabId: number) => {
      if (!isMounted) return;
      if (activeTabIdRef.current === removedTabId) {
        // The targeted or pinned tab was closed -> unpin and fall back to current active tab
        if (isPinnedRef.current) {
          setIsPinnedState(false);
          try {
            localStorage.setItem(PIN_STORAGE_KEY, 'false');
          } catch {}
        }
        void resolveActiveTab();
      }
    };

    // Listen for explicit extension action clicks or background events
    const handleRuntimeMessage = (msg: unknown) => {
      if (!isBgToPanelEvent(msg)) return;
      if (msg.type === 'EVENT_ACTION_CLICKED') {
        const winId = currentWindowIdRef.current;
        if (winId === null || msg.windowId === undefined || msg.windowId === winId) {
          // User explicitly clicked extension icon on this tab in our window -> target this tab
          setActiveTabId(msg.tabId);
        }
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      isMounted = false;
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocusChanged);
      chrome.tabs.onRemoved.removeListener(handleTabRemoved);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, []);

  return { activeTabId, isPinned, togglePin };
}

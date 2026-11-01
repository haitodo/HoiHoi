import { useEffect, useState } from 'react';

/**
 * Robustly tracks the active tab ID from within Side Panel.
 * Handles differences between Chrome and Edge sidebar contexts.
 */
export function useActiveTabId(): number | null {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function resolveActiveTab() {
      try {
        // 1. Try lastFocusedWindow: true (the main browser window the user was interacting with)
        const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (isMounted && focusedTabs[0]?.id !== undefined) {
          setActiveTabId(focusedTabs[0].id);
          return;
        }

        // 2. Fallback to currentWindow: true
        const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isMounted && currentTabs[0]?.id !== undefined) {
          setActiveTabId(currentTabs[0].id);
          return;
        }

        // 3. Fallback to any active tab in any window
        const anyActive = await chrome.tabs.query({ active: true });
        if (isMounted && anyActive[0]?.id !== undefined) {
          setActiveTabId(anyActive[0].id);
        }
      } catch (err) {
        console.warn('[WIC] Failed to resolve active tab:', err);
      }
    }

    void resolveActiveTab();

    // Listen for tab switching
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (!isMounted) return;
      setActiveTabId(activeInfo.tabId);
    };

    // Listen for window focus change (e.g. user clicks between windows)
    const handleWindowFocusChanged = () => {
      if (!isMounted) return;
      void resolveActiveTab();
    };

    // Listen for tab updates (e.g. URL changes or navigation in active tab)
    const handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (!isMounted) return;
      if (changeInfo.status === 'complete' || changeInfo.url) {
        void resolveActiveTab();
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      isMounted = false;
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocusChanged);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, []);

  return activeTabId;
}

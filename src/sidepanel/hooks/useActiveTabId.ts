import { useEffect, useState } from 'react';

/**
 * Tracks the current active tab ID within the window where Side Panel is hosted.
 * Note: `chrome.tabs.query` and `chrome.tabs.onActivated` do NOT require the broad `tabs` permission.
 */
export function useActiveTabId(): number | null {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function queryActiveTab() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (isMounted && tab?.id !== undefined) {
          setActiveTabId(tab.id);
        }
      } catch (err) {
        console.warn('[WIC] Failed to query active tab:', err);
      }
    }

    void queryActiveTab();

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      // Check if activated tab belongs to the current window
      chrome.windows.getCurrent((win) => {
        if (win.id === activeInfo.windowId && isMounted) {
          setActiveTabId(activeInfo.tabId);
        }
      });
    };

    chrome.tabs.onActivated.addListener(handleActivated);

    return () => {
      isMounted = false;
      chrome.tabs.onActivated.removeListener(handleActivated);
    };
  }, []);

  return activeTabId;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isBgToPanelEvent,
  type MessageResult,
  type PanelToBackgroundMessage,
} from '@shared/messages';
import type { ImageItem, ItemDownloadState, TabSessionSnapshot } from '@shared/types';

export function useTabSession(tabId: number | null) {
  const [snapshot, setSnapshot] = useState<TabSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const revisionRef = useRef<number>(0);

  const fetchSnapshot = useCallback(async (targetTabId: number) => {
    setLoading(true);
    try {
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_GET_TAB_SESSION',
        tabId: targetTabId,
      };
      const res = (await chrome.runtime.sendMessage(msg)) as MessageResult<TabSessionSnapshot>;
      if (res?.ok) {
        setSnapshot(res.data);
        revisionRef.current = res.data.revision;
      }
    } catch (err) {
      console.warn('[WIC] Failed to fetch tab session snapshot:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch initial snapshot whenever active tabId changes
  useEffect(() => {
    if (tabId === null) {
      setSnapshot(null);
      return;
    }
    void fetchSnapshot(tabId);
  }, [tabId, fetchSnapshot]);

  // Subscribe to background delta events with self-healing revision tracking
  useEffect(() => {
    if (tabId === null) return;

    const handleMessage = (msg: unknown) => {
      if (!isBgToPanelEvent(msg) || msg.tabId !== tabId) return;

      if (msg.type === 'EVENT_SESSION_REPLACED') {
        setSnapshot(msg.snapshot);
        revisionRef.current = msg.snapshot.revision;
        return;
      }

      // Check revision consistency
      const expectedRevision = revisionRef.current + 1;
      if (msg.revision !== expectedRevision) {
        // Missed message detected -> self-heal via full snapshot
        void fetchSnapshot(tabId);
        return;
      }

      revisionRef.current = msg.revision;

      setSnapshot((prev) => {
        if (!prev) return null;

        switch (msg.type) {
          case 'EVENT_ITEMS_UPSERTED': {
            const upsertMap = new Map<string, ImageItem>(
              msg.upsertedItems.map((i) => [i.itemId, i]),
            );
            const nextItems = prev.items.map((existing) => {
              const updated = upsertMap.get(existing.itemId);
              if (updated) {
                upsertMap.delete(existing.itemId);
                return updated;
              }
              return existing;
            });
            // Append newly added items
            for (const newItem of upsertMap.values()) {
              nextItems.push(newItem);
            }
            return {
              ...prev,
              revision: msg.revision,
              items: nextItems,
              scanStatus: msg.scanStatus,
            };
          }

          case 'EVENT_SCAN_STATUS_CHANGED': {
            return {
              ...prev,
              revision: msg.revision,
              scanStatus: msg.scanStatus,
              statusMessage: msg.statusMessage,
            };
          }

          case 'EVENT_SELECTION_CHANGED': {
            return {
              ...prev,
              revision: msg.revision,
              selectedIds: msg.selectedIds,
            };
          }

          case 'EVENT_DOWNLOADS_UPDATED': {
            const nextDownloads: Record<string, ItemDownloadState> = {
              ...prev.downloads,
            };
            for (const dl of msg.updatedDownloads) {
              nextDownloads[dl.itemId] = dl;
            }
            return {
              ...prev,
              revision: msg.revision,
              downloads: nextDownloads,
            };
          }
        }
      });
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [tabId, fetchSnapshot]);

  // Command dispatchers
  const triggerRescan = useCallback(async () => {
    if (tabId === null) return;
    const msg: PanelToBackgroundMessage = {
      channel: 'WIC_PANEL_TO_BG',
      type: 'PANEL_TRIGGER_RESCAN',
      tabId,
    };
    await chrome.runtime.sendMessage(msg);
  }, [tabId]);

  const toggleSelection = useCallback(
    async (itemId: string) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_UPDATE_SELECTION',
        tabId,
        mutation: { mode: 'toggle_one', itemId },
      };
      await chrome.runtime.sendMessage(msg);
    },
    [tabId],
  );

  const selectAllVisible = useCallback(
    async (itemIds: string[]) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_UPDATE_SELECTION',
        tabId,
        mutation: { mode: 'add_many', itemIds },
      };
      await chrome.runtime.sendMessage(msg);
    },
    [tabId],
  );

  const clearAllSelection = useCallback(async () => {
    if (tabId === null) return;
    const msg: PanelToBackgroundMessage = {
      channel: 'WIC_PANEL_TO_BG',
      type: 'PANEL_UPDATE_SELECTION',
      tabId,
      mutation: { mode: 'clear_all' },
    };
    await chrome.runtime.sendMessage(msg);
  }, [tabId]);

  const selectVariant = useCallback(
    async (itemId: string, variantUrl: string) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_SELECT_VARIANT',
        tabId,
        itemId,
        variantUrl,
      };
      await chrome.runtime.sendMessage(msg);
    },
    [tabId],
  );

  const reportThumbDimensions = useCallback(
    (itemId: string, variantUrl: string, width: number, height: number) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_REPORT_THUMB_DIMENSIONS',
        tabId,
        itemId,
        variantUrl,
        naturalWidth: width,
        naturalHeight: height,
      };
      chrome.runtime.sendMessage(msg).catch(() => {});
    },
    [tabId],
  );

  const enqueueDownloads = useCallback(
    async (itemIds: string[]) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_ENQUEUE_DOWNLOADS',
        tabId,
        itemIds,
      };
      await chrome.runtime.sendMessage(msg);
    },
    [tabId],
  );

  const retryFailedDownloads = useCallback(
    async (itemIds?: string[]) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_RETRY_FAILED_DOWNLOADS',
        tabId,
        itemIds,
      };
      await chrome.runtime.sendMessage(msg);
    },
    [tabId],
  );

  return {
    snapshot,
    loading,
    triggerRescan,
    toggleSelection,
    selectAllVisible,
    clearAllSelection,
    selectVariant,
    reportThumbDimensions,
    enqueueDownloads,
    retryFailedDownloads,
  };
}

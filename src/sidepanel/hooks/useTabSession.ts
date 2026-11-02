import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isBgToPanelEvent,
  type MessageResult,
  type PanelToBackgroundMessage,
} from '@shared/messages';
import type {
  ImageItem,
  ItemDownloadState,
  MediaMode,
  TabSessionSnapshot,
  VideoItem,
} from '@shared/types';
import {
  downloadAndAssembleHlsVod,
  type HlsStreamMergeProgress,
} from '../utils/hls-saver';
import { PANEL_INSTANCE_ID } from '../panel-instance';
import { releaseSidePanelObjectUrl } from './useBlobStreamBridge';

export function useTabSession(tabId: number | null) {
  const [snapshot, setSnapshot] = useState<TabSessionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const revisionRef = useRef<number>(0);
  const targetTabRef = useRef(tabId);
  targetTabRef.current = tabId;
  const requestSequence = useRef(0);
  const pendingRequest = useRef<number | null>(null);

  const fetchSnapshot = useCallback(async (targetTabId: number) => {
    if (pendingRequest.current === targetTabId) return;
    const sequence = ++requestSequence.current;
    pendingRequest.current = targetTabId;
    setLoading(true);
    try {
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_GET_TAB_SESSION',
        tabId: targetTabId,
      };
      const res = (await chrome.runtime.sendMessage(msg)) as MessageResult<TabSessionSnapshot>;
      if (res?.ok && targetTabRef.current === targetTabId && sequence === requestSequence.current) {
        setSnapshot((previous) => previous?.tabId === targetTabId && previous.revision > res.data.revision
          ? previous : res.data);
        revisionRef.current = Math.max(revisionRef.current, res.data.revision);
      }
    } catch (err) {
      console.warn('[WIC] Failed to fetch tab session snapshot:', err);
    } finally {
      if (sequence === requestSequence.current) {
        pendingRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Fetch initial snapshot whenever active tabId changes
  useEffect(() => {
    revisionRef.current = 0;
    requestSequence.current += 1;
    pendingRequest.current = null;
    setSnapshot(null);
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
      if (!isBgToPanelEvent(msg)) return;
      if (msg.type === 'EVENT_ACTION_CLICKED') return;
      if (tabId !== null && tabId > 0 && msg.tabId !== tabId) return;

      if (msg.type === 'EVENT_SESSION_REPLACED') {
        if (msg.snapshot.revision < revisionRef.current) return;
        setSnapshot(msg.snapshot);
        revisionRef.current = msg.snapshot.revision;
        return;
      }

      // Ephemeral live progress updates do not advance revision
      if (msg.type === 'EVENT_DOWNLOAD_PROGRESS') {
        setSnapshot((prev) => {
          if (!prev) return null;
          let changed = false;
          const nextDownloads: Record<string, ItemDownloadState> = { ...prev.downloads };
          for (const u of msg.updates) {
            const existing = nextDownloads[u.itemId];
            if (existing && existing.status === 'in_progress') {
              nextDownloads[u.itemId] = {
                ...existing,
                bytesReceived: u.bytesReceived,
                totalBytes: u.totalBytes ?? existing.totalBytes,
              };
              changed = true;
            }
          }
          return changed ? { ...prev, downloads: nextDownloads } : prev;
        });
        return;
      }

      // Self-heal if any delta event was missed
      if (msg.revision <= revisionRef.current) return;
      if (revisionRef.current > 0 && msg.revision !== revisionRef.current + 1) {
        void fetchSnapshot(msg.tabId);
        return;
      }

      revisionRef.current = msg.revision;

      setSnapshot((prev) => {
        if (!prev || prev.tabId !== tabId) {
          void fetchSnapshot(msg.tabId);
          return null;
        }

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
            for (const newItem of upsertMap.values()) {
              nextItems.push(newItem);
            }
            return {
              ...prev,
              revision: msg.revision,
              items: nextItems,
              scanStatus: msg.scanStatus || 'watching',
            };
          }

          case 'EVENT_VIDEOS_UPSERTED': {
            const upsertMap = new Map<string, VideoItem>(
              msg.upsertedVideos.map((v) => [v.itemId, v]),
            );
            const currentVideos = prev.videos || [];
            const nextVideos = currentVideos.map((existing) => {
              const updated = upsertMap.get(existing.itemId);
              if (updated) {
                upsertMap.delete(existing.itemId);
                return updated;
              }
              return existing;
            });
            for (const newVideo of upsertMap.values()) {
              nextVideos.push(newVideo);
            }
            return {
              ...prev,
              revision: msg.revision,
              videos: nextVideos,
              scanStatus: msg.scanStatus || 'watching',
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

          case 'EVENT_VIDEO_SELECTION_CHANGED': {
            return {
              ...prev,
              revision: msg.revision,
              selectedVideoIds: msg.selectedVideoIds,
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
    const targetTabId = tabId ?? -1;
    const msg: PanelToBackgroundMessage = {
      channel: 'WIC_PANEL_TO_BG',
      type: 'PANEL_TRIGGER_RESCAN',
      tabId: targetTabId,
    };
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[WIC] Failed to send PANEL_TRIGGER_RESCAN:', err);
    }
  }, [tabId]);

  const sendPanelMessage = useCallback(async <T = undefined>(
    msg: PanelToBackgroundMessage,
  ): Promise<MessageResult<T> | undefined> => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) return undefined;
      return (await chrome.runtime.sendMessage({ ...msg, panelId: PANEL_INSTANCE_ID })) as MessageResult<T>;
    } catch (err) {
      console.warn('[WIC Panel] sendMessage failed:', err);
      return undefined;
    }
  }, []);

  const toggleSelection = useCallback(
    async (itemId: string, mediaMode: MediaMode = 'image') => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_UPDATE_SELECTION',
        tabId,
        mediaMode,
        mutation: { mode: 'toggle_one', itemId },
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const selectAllVisible = useCallback(
    async (itemIds: string[], mediaMode: MediaMode = 'image') => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_UPDATE_SELECTION',
        tabId,
        mediaMode,
        mutation: { mode: 'add_many', itemIds },
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const clearAllSelection = useCallback(
    async (mediaMode: MediaMode = 'image') => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_UPDATE_SELECTION',
        tabId,
        mediaMode,
        mutation: { mode: 'clear_all' },
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

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
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
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
      void sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const reportVideoMetadata = useCallback(
    (
      itemId: string,
      variantUrl: string,
      width: number | null,
      height: number | null,
      durationSec: number | null,
    ) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_REPORT_VIDEO_METADATA',
        tabId,
        itemId,
        variantUrl,
        videoWidth: width,
        videoHeight: height,
        durationSec,
      };
      void sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const resolveHlsManifest = useCallback(
    async (itemId: string, manifestUrl: string) => {
      if (tabId === null) return undefined;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_RESOLVE_HLS_MANIFEST',
        tabId,
        itemId,
        manifestUrl,
      };
      return sendPanelMessage<{ addedCount: number; isDrmEncrypted: boolean }>(msg);
    },
    [tabId, sendPanelMessage],
  );

  const mergeAndSaveHlsStream = useCallback(
    async (
      itemId: string,
      manifestUrl: string,
      signal: AbortSignal,
      onProgress?: (progress: HlsStreamMergeProgress) => void,
    ): Promise<void> => {
      if (tabId === null) {
        throw new Error('対象タブが選択されていません');
      }
      const assembled = await downloadAndAssembleHlsVod({
        tabId,
        manifestUrl,
        signal,
        onProgress,
      });
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_SAVE_ASSEMBLED_STREAM',
        tabId,
        itemId,
        objectUrl: assembled.objectUrl,
        sourceManifestUrl: assembled.resolvedManifestUrl,
        containerExtension: assembled.containerExtension,
        totalBytes: assembled.totalBytes,
      };
      const res = await sendPanelMessage(msg);
      if (!res?.ok) {
        releaseSidePanelObjectUrl(assembled.objectUrl);
        throw new Error(res && !res.ok ? res.error : '結合データの保存開始に失敗しました');
      }
    },
    [tabId, sendPanelMessage],
  );

  const enqueueDownloads = useCallback(
    async (itemIds: string[]) => {
      if (tabId === null || itemIds.length === 0) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_ENQUEUE_DOWNLOADS',
        tabId,
        itemIds,
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const cancelDownload = useCallback(
    async (itemId: string) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_CANCEL_DOWNLOAD',
        tabId,
        itemId,
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const saveCapturedFrame = useCallback(
    async (dataUrl: string, sourceVideoUrl: string, timestampSec: number): Promise<boolean> => {
      if (tabId === null) return false;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_SAVE_CAPTURED_FRAME',
        tabId,
        dataUrl,
        sourceVideoUrl,
        timestampSec,
      };
      const res = await sendPanelMessage(msg);
      return Boolean(res?.ok);
    },
    [tabId, sendPanelMessage],
  );

  const retryFailedDownloads = useCallback(
    async (itemIds?: string[], mediaMode?: MediaMode) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_RETRY_FAILED_DOWNLOADS',
        tabId,
        mediaMode,
        itemIds,
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  const batchSelectVariants = useCallback(
    async (
      target: 'high_res' | 'display',
      itemIds?: string[],
      mediaMode: MediaMode = 'image',
    ) => {
      if (tabId === null) return;
      const msg: PanelToBackgroundMessage = {
        channel: 'WIC_PANEL_TO_BG',
        type: 'PANEL_BATCH_SELECT_VARIANTS',
        tabId,
        mediaMode,
        target,
        itemIds,
      };
      await sendPanelMessage(msg);
    },
    [tabId, sendPanelMessage],
  );

  return {
    snapshot: snapshot?.tabId === tabId ? snapshot : null,
    loading,
    triggerRescan,
    toggleSelection,
    selectAllVisible,
    clearAllSelection,
    selectVariant,
    batchSelectVariants,
    reportThumbDimensions,
    reportVideoMetadata,
    resolveHlsManifest,
    mergeAndSaveHlsStream,
    enqueueDownloads,
    cancelDownload,
    saveCapturedFrame,
    retryFailedDownloads,
  };
}

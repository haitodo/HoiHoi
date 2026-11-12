import { useEffect, useRef } from 'react';
import type { MediaMode, ScanStatus } from '@shared/types';

interface MediaEntry {
  itemId: string;
}

export interface UseAutoSelectOnScanOptions<T extends MediaEntry> {
  enabled: boolean;
  mediaMode: MediaMode;
  tabId: number | null;
  scanEpoch: number | undefined;
  scanStatus: ScanStatus | undefined;
  items: readonly T[];
  selectedIds: ReadonlySet<string>;
  onSelectItems: (itemIds: string[], mode: MediaMode) => void;
}

const MAX_TRACKED_EPOCHS = 20;

export function useAutoSelectOnScan<T extends MediaEntry>({
  enabled,
  mediaMode,
  tabId,
  scanEpoch,
  scanStatus,
  items,
  selectedIds,
  onSelectItems,
}: UseAutoSelectOnScanOptions<T>) {
  const processedByTabEpochRef = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    if (mediaMode !== 'image' || tabId === null || scanEpoch === undefined) return;
    if (scanStatus === 'unscanned' || scanStatus === 'restricted' || scanStatus === 'stale') return;

    const epochKey = `${tabId}:${scanEpoch}`;
    const map = processedByTabEpochRef.current;

    let knownIds = map.get(epochKey);
    if (!knownIds) {
      knownIds = new Set<string>();
      if (map.size >= MAX_TRACKED_EPOCHS) {
        const oldestKey = map.keys().next().value;
        if (oldestKey) map.delete(oldestKey);
      }
      map.set(epochKey, knownIds);

      // 初回検知時、すでに選択状態が存在するセッションであれば既存の選択状態を尊重して現在の一覧を既知として登録
      if (selectedIds.size > 0) {
        for (const item of items) {
          knownIds.add(item.itemId);
        }
        return;
      }
    }

    if (!enabled) {
      for (const item of items) {
        knownIds.add(item.itemId);
      }
      return;
    }

    const newIdsToSelect: string[] = [];
    for (const item of items) {
      if (!knownIds.has(item.itemId)) {
        knownIds.add(item.itemId);
        if (!selectedIds.has(item.itemId)) {
          newIdsToSelect.push(item.itemId);
        }
      }
    }

    if (newIdsToSelect.length > 0) {
      onSelectItems(newIdsToSelect, 'image');
    }
  }, [enabled, mediaMode, tabId, scanEpoch, scanStatus, items, selectedIds, onSelectItems]);
}

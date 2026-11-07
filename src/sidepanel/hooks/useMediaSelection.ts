import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { MediaMode } from '@shared/types';

interface MediaEntry {
  itemId: string;
}

interface MediaSelectionOptions<T extends MediaEntry> {
  items: readonly T[];
  selectedIds: ReadonlySet<string>;
  mode: MediaMode;
  activeMode: MediaMode;
  tabId: number | null;
  isSelectable?: (item: T) => boolean;
  toggleSelection: (itemId: string, mode: MediaMode) => void;
  selectAllVisible: (itemIds: string[], mode: MediaMode) => void;
  deselectVisible: (itemIds: string[], mode: MediaMode) => void;
}

function getSelectableIds<T extends MediaEntry>(items: readonly T[], isSelectable?: (item: T) => boolean) {
  return (isSelectable ? items.filter(isSelectable) : items).map((item) => item.itemId);
}

export function useMediaSelection<T extends MediaEntry>({
  items,
  selectedIds,
  mode,
  activeMode,
  tabId,
  isSelectable,
  toggleSelection,
  selectAllVisible,
  deselectVisible,
}: MediaSelectionOptions<T>) {
  const visibleIds = useMemo(() => getSelectableIds(items), [items]);
  const selectableIds = useMemo(
    () => isSelectable ? getSelectableIds(items, isSelectable) : visibleIds,
    [items, isSelectable, visibleIds],
  );
  const visibleSelectedIds = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  );

  const anchorRef = useRef<string | null>(null);
  useEffect(() => {
    anchorRef.current = null;
  }, [tabId, activeMode]);

  const onToggle = useCallback((targetId: string, event?: Pick<MouseEvent, 'shiftKey'>) => {
    const anchorId = anchorRef.current;
    anchorRef.current = targetId;

    if (event?.shiftKey && anchorId && anchorId !== targetId) {
      const from = visibleIds.indexOf(anchorId);
      const to = visibleIds.indexOf(targetId);
      if (from !== -1 && to !== -1) {
        const range = items.slice(Math.min(from, to), Math.max(from, to) + 1);
        const rangeIds = getSelectableIds(range, isSelectable);
        if (selectedIds.has(anchorId) || !selectedIds.has(targetId)) {
          selectAllVisible(rangeIds, mode);
        } else {
          deselectVisible(rangeIds, mode);
        }
        return;
      }
    }

    toggleSelection(targetId, mode);
  }, [items, visibleIds, isSelectable, selectedIds, mode, selectAllVisible, deselectVisible, toggleSelection]);

  return {
    visibleIds,
    selectableCount: selectableIds.length,
    visibleSelectedCount: visibleSelectedIds.length,
    hiddenSelectedCount: selectedIds.size - visibleSelectedIds.length,
    onSelectVisible: () => selectAllVisible(selectableIds, mode),
    onDeselectVisible: () => deselectVisible(visibleSelectedIds, mode),
    onToggle,
  };
}

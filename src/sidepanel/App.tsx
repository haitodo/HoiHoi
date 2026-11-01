import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractFilenameForSort } from '@shared/filename-utils';
import type { FilterState, ImageItem, SortOrder } from '@shared/types';
import { DownloadFooter } from './components/DownloadFooter';
import { EmptyOrStatusView } from './components/EmptyOrStatusView';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { ImageGrid } from './components/ImageGrid';
import { SelectionToolbar } from './components/SelectionToolbar';
import { useActiveTabId } from './hooks/useActiveTabId';
import { useTabSession } from './hooks/useTabSession';

const DEFAULT_FILTER: FilterState = {
  urlQuery: '',
  minWidth: null,
  minHeight: null,
  formats: [],
  includeUnknownDimensions: false,
};

const FILTER_PREFS_KEY = 'wic_filter_preferences';

interface SavedFilterPreferences {
  minWidth: number | null;
  minHeight: number | null;
  formats: FilterState['formats'];
  includeUnknownDimensions: boolean;
}

function loadSavedFilterPreferences(): Partial<FilterState> {
  try {
    const raw = localStorage.getItem(FILTER_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        minWidth:
          typeof parsed.minWidth === 'number' && parsed.minWidth > 0 ? parsed.minWidth : null,
        minHeight:
          typeof parsed.minHeight === 'number' && parsed.minHeight > 0 ? parsed.minHeight : null,
        formats: Array.isArray(parsed.formats) ? parsed.formats : [],
        includeUnknownDimensions: Boolean(parsed.includeUnknownDimensions),
      };
    }
  } catch {}
  return {};
}

function saveFilterPreferences(filter: FilterState): void {
  try {
    const prefs: SavedFilterPreferences = {
      minWidth: filter.minWidth,
      minHeight: filter.minHeight,
      formats: filter.formats,
      includeUnknownDimensions: filter.includeUnknownDimensions,
    };
    localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export function App() {
  const { activeTabId, isPinned, togglePin } = useActiveTabId();
  const {
    snapshot,
    triggerRescan,
    toggleSelection,
    selectAllVisible,
    clearAllSelection,
    selectVariant,
    batchSelectVariants,
    reportThumbDimensions,
    enqueueDownloads,
    retryFailedDownloads,
  } = useTabSession(activeTabId);

  const [filter, setFilterState] = useState<FilterState>(() => {
    const saved = loadSavedFilterPreferences();
    return {
      urlQuery: '', // transient per inspection
      minWidth: saved.minWidth ?? null,
      minHeight: saved.minHeight ?? null,
      formats: saved.formats ?? [],
      includeUnknownDimensions: saved.includeUnknownDimensions ?? false,
    };
  });

  const handleFilterChange = useCallback((nextFilter: FilterState) => {
    setFilterState(nextFilter);
    saveFilterPreferences(nextFilter);
  }, []);

  const handleResetFilter = useCallback(() => {
    setFilterState(DEFAULT_FILTER);
    saveFilterPreferences(DEFAULT_FILTER);
  }, []);
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    try {
      const saved = localStorage.getItem('wic_sort_order');
      if (
        saved === 'position_asc' ||
        saved === 'position_desc' ||
        saved === 'size_desc' ||
        saved === 'size_asc' ||
        saved === 'filename_asc' ||
        saved === 'filename_desc' ||
        saved === 'selected_first'
      ) {
        return saved;
      }
    } catch {}
    return 'position_asc';
  });

  const handleSortChange = useCallback((nextOrder: SortOrder) => {
    setSortOrder(nextOrder);
    try {
      localStorage.setItem('wic_sort_order', nextOrder);
    } catch {}
  }, []);

  const rawItems = snapshot?.items || [];
  const selectedIdsSet = useMemo(() => new Set(snapshot?.selectedIds || []), [snapshot?.selectedIds]);

  // Count items with unknown dimensions when dimension filtering is active
  const hasDimensionFilter = (filter.minWidth ?? 0) > 0 || (filter.minHeight ?? 0) > 0;

  const { filteredItems, unknownDimensionsCount } = useMemo(() => {
    let unknownCount = 0;
    const query = filter.urlQuery.trim().toLowerCase();

    // 1. Filter items
    const matched = rawItems.filter((item: ImageItem) => {
      const activeVariant =
        item.variants.find((v) => v.url === item.selectedUrl) || item.variants[0];

      // 1. URL search filter
      if (query && !item.selectedUrl.toLowerCase().includes(query)) {
        return false;
      }

      // 2. Format filter
      if (filter.formats.length > 0) {
        const fmt = activeVariant?.format || 'unknown';
        if (!filter.formats.includes(fmt)) {
          return false;
        }
      }

      // 3. Dimension filter
      if (hasDimensionFilter) {
        const w = activeVariant?.naturalWidth;
        const h = activeVariant?.naturalHeight;

        if (w === null || w === undefined || h === null || h === undefined) {
          unknownCount++;
          if (!filter.includeUnknownDimensions) {
            return false;
          }
        } else {
          if (filter.minWidth && w < filter.minWidth) return false;
          if (filter.minHeight && h < filter.minHeight) return false;
        }
      }

      return true;
    });

    // 2. Sort items
    const sorted = [...matched].sort((a, b) => {
      const aVariant = a.variants.find((v) => v.url === a.selectedUrl) || a.variants[0];
      const bVariant = b.variants.find((v) => v.url === b.selectedUrl) || b.variants[0];

      switch (sortOrder) {
        case 'position_asc':
          return a.firstSeenOrder - b.firstSeenOrder;

        case 'position_desc':
          return b.firstSeenOrder - a.firstSeenOrder;

        case 'size_desc': {
          const aPixels =
            aVariant?.naturalWidth && aVariant?.naturalHeight
              ? aVariant.naturalWidth * aVariant.naturalHeight
              : null;
          const bPixels =
            bVariant?.naturalWidth && bVariant?.naturalHeight
              ? bVariant.naturalWidth * bVariant.naturalHeight
              : null;

          if (aPixels !== null && bPixels !== null) {
            if (bPixels !== aPixels) return bPixels - aPixels;
          } else if (aPixels !== null) {
            return -1; // a has known dimensions, prioritize first
          } else if (bPixels !== null) {
            return 1; // b has known dimensions, prioritize first
          }
          return a.firstSeenOrder - b.firstSeenOrder;
        }

        case 'size_asc': {
          const aPixels =
            aVariant?.naturalWidth && aVariant?.naturalHeight
              ? aVariant.naturalWidth * aVariant.naturalHeight
              : null;
          const bPixels =
            bVariant?.naturalWidth && bVariant?.naturalHeight
              ? bVariant.naturalWidth * bVariant.naturalHeight
              : null;

          if (aPixels !== null && bPixels !== null) {
            if (aPixels !== bPixels) return aPixels - bPixels;
          } else if (aPixels !== null) {
            return -1; // a has known dimensions, prioritize first
          } else if (bPixels !== null) {
            return 1; // b has known dimensions, prioritize first
          }
          return a.firstSeenOrder - b.firstSeenOrder;
        }

        case 'filename_asc': {
          const aName = extractFilenameForSort(a.selectedUrl);
          const bName = extractFilenameForSort(b.selectedUrl);
          const cmp = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return a.firstSeenOrder - b.firstSeenOrder;
        }

        case 'filename_desc': {
          const aName = extractFilenameForSort(a.selectedUrl);
          const bName = extractFilenameForSort(b.selectedUrl);
          const cmp = bName.localeCompare(aName, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return a.firstSeenOrder - b.firstSeenOrder;
        }

        case 'selected_first': {
          const aSelected = selectedIdsSet.has(a.itemId) ? 1 : 0;
          const bSelected = selectedIdsSet.has(b.itemId) ? 1 : 0;
          if (aSelected !== bSelected) {
            return bSelected - aSelected;
          }
          return a.firstSeenOrder - b.firstSeenOrder;
        }

        default:
          return a.firstSeenOrder - b.firstSeenOrder;
      }
    });

    return { filteredItems: sorted, unknownDimensionsCount: unknownCount };
  }, [rawItems, filter, hasDimensionFilter, sortOrder, selectedIdsSet]);

  // Calculate selected items that are currently hidden by filters (MVP-09, AT-12)
  const visibleItemIds = useMemo(() => filteredItems.map((i) => i.itemId), [filteredItems]);
  const visibleItemIdsSet = useMemo(() => new Set(visibleItemIds), [visibleItemIds]);

  const hiddenSelectedCount = useMemo(() => {
    let count = 0;
    for (const id of selectedIdsSet) {
      if (!visibleItemIdsSet.has(id)) {
        count++;
      }
    }
    return count;
  }, [selectedIdsSet, visibleItemIdsSet]);

  const hasVariants = useMemo(() => rawItems.some((i) => i.variants.length > 1), [rawItems]);

  const scanStatus = snapshot?.scanStatus || 'unscanned';
  const showEmptyView =
    scanStatus === 'unscanned' ||
    scanStatus === 'restricted' ||
    (filteredItems.length === 0 && rawItems.length === 0) ||
    filteredItems.length === 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        margin: 0,
        padding: 0,
        boxSizing: 'border-box',
        backgroundColor: '#f9fafb',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      <Header
        domain={snapshot?.domain}
        pageTitle={snapshot?.pageTitle}
        itemCount={rawItems.length}
        scanStatus={scanStatus}
        statusMessage={snapshot?.statusMessage}
        onRescan={triggerRescan}
        isPinned={isPinned}
        onTogglePin={togglePin}
      />

      {scanStatus !== 'unscanned' && scanStatus !== 'restricted' && (
        <>
          <FilterBar
            filter={filter}
            onChange={handleFilterChange}
            sortOrder={sortOrder}
            onSortChange={handleSortChange}
            onReset={handleResetFilter}
            unknownDimensionsCount={unknownDimensionsCount}
          />

          <SelectionToolbar
            selectedCount={selectedIdsSet.size}
            hiddenSelectedCount={hiddenSelectedCount}
            visibleCount={filteredItems.length}
            hasVariants={hasVariants}
            onSelectVisible={() => selectAllVisible(visibleItemIds)}
            onClearAll={clearAllSelection}
            onDownloadSelected={() => enqueueDownloads(Array.from(selectedIdsSet))}
            onApplyVariantPreference={(target) => batchSelectVariants(target, visibleItemIds)}
          />
        </>
      )}

      {showEmptyView ? (
        <EmptyOrStatusView
          scanStatus={scanStatus}
          statusMessage={snapshot?.statusMessage}
          isFilterEmpty={rawItems.length > 0 && filteredItems.length === 0}
          onClearFilter={handleResetFilter}
          onRescan={triggerRescan}
        />
      ) : (
        <ImageGrid
          items={filteredItems}
          selectedIds={selectedIdsSet}
          downloads={snapshot?.downloads || {}}
          onToggleSelect={toggleSelection}
          onSelectVariant={selectVariant}
          onReportDimensions={reportThumbDimensions}
          onDownloadItem={(itemId) => enqueueDownloads([itemId])}
        />
      )}

      <DownloadFooter
        downloads={snapshot?.downloads || {}}
        onRetryFailed={retryFailedDownloads}
      />
    </div>
  );
}

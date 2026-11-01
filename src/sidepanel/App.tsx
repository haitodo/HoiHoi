import { useEffect, useMemo, useState } from 'react';
import type { FilterState, ImageItem } from '@shared/types';
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

export function App() {
  const activeTabId = useActiveTabId();
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

  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  const rawItems = snapshot?.items || [];
  const selectedIdsSet = useMemo(() => new Set(snapshot?.selectedIds || []), [snapshot?.selectedIds]);

  // Auto-trigger scan when Side Panel opens on an unscanned scannable page
  useEffect(() => {
    if (activeTabId && snapshot && snapshot.scanStatus === 'unscanned') {
      void triggerRescan();
    }
  }, [activeTabId, snapshot?.scanStatus, triggerRescan]);

  // Count items with unknown dimensions when dimension filtering is active
  const hasDimensionFilter = (filter.minWidth ?? 0) > 0 || (filter.minHeight ?? 0) > 0;

  const { filteredItems, unknownDimensionsCount } = useMemo(() => {
    let unknownCount = 0;
    const query = filter.urlQuery.trim().toLowerCase();

    const result = rawItems.filter((item: ImageItem) => {
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

    return { filteredItems: result, unknownDimensionsCount: unknownCount };
  }, [rawItems, filter, hasDimensionFilter]);

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
        itemCount={rawItems.length}
        scanStatus={scanStatus}
        statusMessage={snapshot?.statusMessage}
        onRescan={triggerRescan}
      />

      {scanStatus !== 'unscanned' && scanStatus !== 'restricted' && (
        <>
          <FilterBar
            filter={filter}
            onChange={setFilter}
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
          onClearFilter={() => setFilter(DEFAULT_FILTER)}
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

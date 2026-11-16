import { useCallback, useId, useMemo, useState } from 'react';
import type { ImageItem, TabSessionSnapshot, VideoItem } from '@shared/types';
import { formatByteSize, getActiveVideoVariant } from '@shared/video-utils';
import { DownloadFooter } from './components/DownloadFooter';
import { EmptyOrStatusView } from './components/EmptyOrStatusView';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { SlidersIcon } from './components/Icons';
import { ImageGrid } from './components/ImageGrid';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { MediaModeTabs } from './components/MediaModeTabs';
import { ScanTools } from './components/ScanTools';
import { SelectionOptions, SelectionToolbar } from './components/SelectionToolbar';
import { VideoFilterBar, VideoProbeStatus } from './components/VideoFilterBar';
import { VideoGrid } from './components/VideoGrid';
import { VideoLightboxModal } from './components/VideoLightboxModal';
import { useActiveTabId } from './hooks/useActiveTabId';
import { useAutoSelectOnScan } from './hooks/useAutoSelectOnScan';
import { useBlobStreamBridge } from './hooks/useBlobStreamBridge';
import { useMediaSelection } from './hooks/useMediaSelection';
import { usePanelActivity } from './hooks/usePanelActivity';
import { usePanelPreferences } from './hooks/usePanelPreferences';
import { useTabSession } from './hooks/useTabSession';
import { useVideoMetadataProber } from './hooks/useVideoMetadataProber';
import { getImageView, getVideoView } from './utils/media-view';

const EMPTY_IMAGES: ImageItem[] = [];
const EMPTY_VIDEOS: VideoItem[] = [];
const EMPTY_DOWNLOADS: TabSessionSnapshot['downloads'] = {};

function isVideoSelectable(video: VideoItem): boolean {
  return getActiveVideoVariant(video.variants, video.selectedUrl)?.readiness === 'ready';
}

export function App() {
  useBlobStreamBridge();

  const { activeTabId, isPinned, togglePin } = useActiveTabId();
  const {
    snapshot,
    triggerRescan,
    toggleSelection,
    selectAllVisible,
    deselectVisible,
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
  } = useTabSession(activeTabId);

  const isPanelVisible = usePanelActivity(activeTabId, snapshot);
  const scanStatus = snapshot?.scanStatus ?? 'unscanned';
  const isGlobalBlockedStatus = scanStatus === 'unscanned' || scanStatus === 'restricted' || scanStatus === 'stale';
  const rawItems = isGlobalBlockedStatus ? EMPTY_IMAGES : snapshot?.items ?? EMPTY_IMAGES;
  const rawVideos = isGlobalBlockedStatus ? EMPTY_VIDEOS : snapshot?.videos ?? EMPTY_VIDEOS;
  const downloads = snapshot?.downloads ?? EMPTY_DOWNLOADS;

  const {
    isProbing: isVideoProbing,
    progress: videoProbeProgress,
    startProbing: startVideoProbing,
    stopProbing: stopVideoProbing,
    unprobedCount: unprobedVideoCount,
  } = useVideoMetadataProber({
    videos: rawVideos,
    onReportVideoMetadata: reportVideoMetadata,
    targetTabId: activeTabId,
    enabled: isPanelVisible,
  });

  const { mediaMode, setMediaMode, image: imagePrefs, video: videoPrefs } = usePanelPreferences();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const [allowedUnknownSessions, setAllowedUnknownSessions] = useState<ReadonlySet<string>>(() => new Set());
  const sessionKey = activeTabId !== null && snapshot?.scanEpoch !== undefined && !isGlobalBlockedStatus
    ? `${activeTabId}:${snapshot.scanEpoch}`
    : null;
  const allowUnknownSelection = sessionKey !== null && allowedUnknownSessions.has(sessionKey);
  const setAllowUnknownSelectionForSession = useCallback((allow: boolean) => {
    if (!sessionKey) return;
    setAllowedUnknownSessions((prev) => {
      if (allow === prev.has(sessionKey)) return prev;
      const next = new Set(prev);
      if (allow) {
        if (next.size >= 20) {
          const oldest = next.values().next().value;
          if (oldest) next.delete(oldest);
        }
        next.add(sessionKey);
      } else {
        next.delete(sessionKey);
      }
      return next;
    });
  }, [sessionKey]);

  const selectedImageIds = useMemo(() => new Set(snapshot?.selectedIds), [snapshot?.selectedIds]);
  const selectedVideoIds = useMemo(() => new Set(snapshot?.selectedVideoIds), [snapshot?.selectedVideoIds]);

  const imageSortSelection = imagePrefs.sortOrder === 'selected_first' ? selectedImageIds : undefined;
  const videoSortSelection = videoPrefs.sortOrder === 'selected_first' ? selectedVideoIds : undefined;
  const { filteredItems, unknownDimensionIds } = useMemo(
    () => getImageView(
      rawItems,
      imagePrefs.filter,
      imagePrefs.sortOrder,
      imageSortSelection,
      { allowUnknownDimensions: allowUnknownSelection },
    ),
    [rawItems, imagePrefs.filter, imagePrefs.sortOrder, imageSortSelection, allowUnknownSelection],
  );
  const canSelectImage = useCallback(
    (item: ImageItem) => allowUnknownSelection || !unknownDimensionIds.has(item.itemId),
    [allowUnknownSelection, unknownDimensionIds],
  );
  const selectableImages = useMemo(
    () => !allowUnknownSelection && unknownDimensionIds.size > 0
      ? filteredItems.filter(canSelectImage)
      : filteredItems,
    [filteredItems, canSelectImage, allowUnknownSelection, unknownDimensionIds],
  );
  const { filteredVideos, unknownVideoMetadataCount } = useMemo(
    () => getVideoView(rawVideos, videoPrefs.filter, videoPrefs.sortOrder, videoSortSelection),
    [rawVideos, videoPrefs.filter, videoPrefs.sortOrder, videoSortSelection],
  );

  const selectionActions = {
    activeMode: mediaMode,
    tabId: activeTabId,
    toggleSelection,
    selectAllVisible,
    deselectVisible,
  };
  const imageSelection = useMediaSelection({
    ...selectionActions,
    mode: 'image',
    items: selectableImages,
    selectedIds: selectedImageIds,
  });

  useAutoSelectOnScan({
    enabled: imagePrefs.autoSelectAll,
    mediaMode,
    tabId: activeTabId,
    scanEpoch: snapshot?.scanEpoch,
    scanStatus,
    items: selectableImages,
    selectedIds: selectedImageIds,
    onSelectItems: selectAllVisible,
  });

  const videoSelection = useMediaSelection({
    ...selectionActions,
    mode: 'video',
    items: filteredVideos,
    selectedIds: selectedVideoIds,
    isSelectable: isVideoSelectable,
  });

  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const previewItemIndex = useMemo(() => {
    if (!previewItemId) return -1;
    return filteredItems.findIndex((item) => item.itemId === previewItemId);
  }, [previewItemId, filteredItems]);
  const previewItem = previewItemIndex >= 0 ? filteredItems[previewItemIndex] : null;

  const previewVideoIndex = useMemo(() => {
    if (!previewVideoId) return -1;
    return filteredVideos.findIndex((v) => v.itemId === previewVideoId);
  }, [previewVideoId, filteredVideos]);
  const previewVideo = previewVideoIndex >= 0 ? filteredVideos[previewVideoIndex] : null;

  const hasImageVariants = useMemo(() => rawItems.some((i) => i.variants.length > 1), [rawItems]);
  const hasVideoVariants = useMemo(() => rawVideos.some((v) => v.variants.length > 1), [rawVideos]);

  const handleBatchVideoDownload = useCallback(() => {
    const ids = Array.from(selectedVideoIds);
    if (ids.length === 0) return;

    // Safety confirmation for heavy multi-video batch downloads (5+ videos or >=300MB known size)
    let knownTotalBytes = 0;
    for (const v of rawVideos) {
      if (selectedVideoIds.has(v.itemId)) {
        const av = getActiveVideoVariant(v.variants, v.selectedUrl);
        if (av?.fileSizeBytes) knownTotalBytes += av.fileSizeBytes;
      }
    }

    if (ids.length >= 5 || knownTotalBytes >= 300 * 1024 * 1024) {
      const sizeNotice = knownTotalBytes > 0 ? `（判明分合計: 約 ${formatByteSize(knownTotalBytes)}）` : '';
      const confirmed = window.confirm(
        `選択中の動画 ${ids.length} 件${sizeNotice}を一括ダウンロードしますか？`,
      );
      if (!confirmed) return;
    }

    void enqueueDownloads(ids);
  }, [selectedVideoIds, rawVideos, enqueueDownloads]);

  const handleCancelActiveDownloads = useCallback(
    (itemIds: string[]) => {
      for (const id of itemIds) {
        void cancelDownload(id);
      }
    },
    [cancelDownload],
  );

  const showImageEmptyView = isGlobalBlockedStatus || filteredItems.length === 0;
  const showVideoEmptyView = isGlobalBlockedStatus || filteredVideos.length === 0;

  const isImageMode = mediaMode === 'image';
  const selection = isImageMode ? imageSelection : videoSelection;
  const selectedCount = isImageMode ? imageSelection.visibleSelectedCount : selectedVideoIds.size;
  const hasVariants = isImageMode ? hasImageVariants : hasVideoVariants;
  const { cardSize, setCardSize } = isImageMode ? imagePrefs : videoPrefs;
  const hasImageDimensionFilter = (imagePrefs.filter.minWidth ?? 0) > 0 || (imagePrefs.filter.minHeight ?? 0) > 0;
  const scanUnknownDimensions =
    hasImageDimensionFilter && unknownDimensionIds.size > 0
      ? {
          count: unknownDimensionIds.size,
          includeUnknown: imagePrefs.filter.includeUnknownDimensions,
          onToggleIncludeUnknown: (include: boolean) =>
            imagePrefs.setFilter({ ...imagePrefs.filter, includeUnknownDimensions: include }),
          allowUnknownSelection,
          onToggleAllowUnknownSelection: setAllowUnknownSelectionForSession,
        }
      : undefined;

  function applyHighestQuality() {
    const itemIds = isImageMode ? filteredItems.map((item) => item.itemId) : videoSelection.visibleIds;
    void batchSelectVariants('high_res', itemIds, mediaMode);
  }

  return (
    <div className="app-shell">
      <Header
        domain={snapshot?.domain}
        pageTitle={snapshot?.pageTitle}
        scanStatus={scanStatus}
        statusMessage={snapshot?.statusMessage}
        onRescan={triggerRescan}
        isPinned={isPinned}
        onTogglePin={togglePin}
      />

      {!isGlobalBlockedStatus && (
        <>
          <div className="panel-mode-bar">
            <MediaModeTabs
              activeMode={mediaMode}
              onChangeMode={setMediaMode}
              imageCount={rawItems.length}
              videoCount={rawVideos.length}
              selectedImageCount={imageSelection.visibleSelectedCount}
              selectedVideoCount={selectedVideoIds.size}
            />
            <button
              type="button"
              className="panel-control panel-options-toggle"
              aria-controls={optionsId}
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen((open) => !open)}
            >
              <SlidersIcon size={11} />
              <span>フィルター・設定</span>
            </button>
          </div>

          <SelectionToolbar
            mediaMode={mediaMode}
            selectedCount={selectedCount}
            hiddenSelectedCount={selection.hiddenSelectedCount}
            selectableCount={selection.selectableCount}
            onSelectVisible={selection.onSelectVisible}
            onDownloadSelected={isImageMode
              ? () => void enqueueDownloads(imageSelection.visibleSelectedIds)
              : handleBatchVideoDownload}
          />

          {isImageMode ? (
            <ScanTools
              snapshot={snapshot}
              enabled={isPanelVisible}
              unknownDimensions={scanUnknownDimensions}
            />
          ) : isVideoProbing && (
            <VideoProbeStatus progress={videoProbeProgress} onStop={stopVideoProbing} />
          )}

          <div id={optionsId} className="panel-options" hidden={!optionsOpen}>
            {isImageMode ? (
              <FilterBar
                filter={imagePrefs.filter}
                onChange={imagePrefs.setFilter}
                sortOrder={imagePrefs.sortOrder}
                onSortChange={imagePrefs.setSortOrder}
                onClear={imagePrefs.clearFilter}
              />
            ) : (
              <VideoFilterBar
                filter={videoPrefs.filter}
                onChange={videoPrefs.setFilter}
                sortOrder={videoPrefs.sortOrder}
                onSortChange={videoPrefs.setSortOrder}
                onReset={videoPrefs.resetFilter}
                unknownMetadataCount={unknownVideoMetadataCount}
                unprobedCount={unprobedVideoCount}
                isProbing={isVideoProbing}
                onStartProbing={() => void startVideoProbing()}
              />
            )}
            <SelectionOptions
              mediaMode={mediaMode}
              cardSize={cardSize}
              onCardSizeChange={setCardSize}
              autoSelectAll={isImageMode ? imagePrefs.autoSelectAll : undefined}
              onAutoSelectAllChange={isImageMode ? imagePrefs.setAutoSelectAll : undefined}
              canDeselectVisible={selection.visibleSelectedCount > 0}
              canClearAll={selectedCount > 0 || selection.hiddenSelectedCount > 0}
              onDeselectVisible={selection.onDeselectVisible}
              onClearAll={() => void clearAllSelection(mediaMode)}
              onApplyHighestQuality={hasVariants ? applyHighestQuality : undefined}
            />
          </div>
        </>
      )}

      {isImageMode ? (
        <>
          {showImageEmptyView ? (
            <EmptyOrStatusView
              mediaMode="image"
              scanStatus={scanStatus}
              statusMessage={snapshot?.statusMessage}
              isFilterEmpty={rawItems.length > 0 && filteredItems.length === 0}
              unknownDimensionCount={hasImageDimensionFilter ? unknownDimensionIds.size : 0}
              onAllowUnknownSelection={
                hasImageDimensionFilter && unknownDimensionIds.size > 0
                  ? () => setAllowUnknownSelectionForSession(true)
                  : undefined
              }
              onClearFilter={imagePrefs.clearFilter}
              onRescan={triggerRescan}
            />
          ) : (
            <ImageGrid
              items={filteredItems}
              selectedIds={selectedImageIds}
              isSelectable={canSelectImage}
              downloads={downloads}
              cardSize={imagePrefs.cardSize}
              onToggleSelect={imageSelection.onToggle}
              onSelectVariant={selectVariant}
              onReportDimensions={reportThumbDimensions}
              onDownloadItem={(itemId) => void enqueueDownloads([itemId])}
              onOpenPreview={(item) => setPreviewItemId(item.itemId)}
            />
          )}
        </>
      ) : (
        <>
          {showVideoEmptyView ? (
            <EmptyOrStatusView
              mediaMode="video"
              scanStatus={scanStatus}
              statusMessage={snapshot?.statusMessage}
              isFilterEmpty={rawVideos.length > 0 && filteredVideos.length === 0}
              onClearFilter={videoPrefs.resetFilter}
              onRescan={triggerRescan}
            />
          ) : (
            <VideoGrid
              isActive={isPanelVisible}
              videos={filteredVideos}
              selectedVideoIds={selectedVideoIds}
              downloads={downloads}
              cardSize={videoPrefs.cardSize}
              onToggleSelect={videoSelection.onToggle}
              onSelectVariant={selectVariant}
              onReportVideoMetadata={reportVideoMetadata}
              onResolveHlsManifest={async (itemId, manifestUrl) => {
                await resolveHlsManifest(itemId, manifestUrl);
              }}
              onMergeHlsStream={mergeAndSaveHlsStream}
              onDownloadVideo={(itemId) => void enqueueDownloads([itemId])}
              onCancelDownload={(itemId) => void cancelDownload(itemId)}
              onOpenPreview={(video) => setPreviewVideoId(video.itemId)}
            />
          )}
        </>
      )}

      <DownloadFooter
        downloads={downloads}
        onRetryFailed={() => void retryFailedDownloads(undefined, mediaMode)}
        onCancelActive={handleCancelActiveDownloads}
      />

      {mediaMode === 'image' && previewItem && (
        <ImageLightboxModal
          items={filteredItems}
          currentIndex={previewItemIndex}
          isSelected={selectedImageIds.has(previewItem.itemId)}
          downloadState={downloads[previewItem.itemId]}
          onClose={() => setPreviewItemId(null)}
          onNavigate={(index) => {
            const next = filteredItems[index];
            if (next) setPreviewItemId(next.itemId);
          }}
          onToggleSelect={canSelectImage(previewItem) ? (id) => void toggleSelection(id, 'image') : undefined}
          onDownload={(itemId) => void enqueueDownloads([itemId])}
          onSelectVariant={selectVariant}
          onReportDimensions={reportThumbDimensions}
        />
      )}

      {isPanelVisible && mediaMode === 'video' && previewVideo && (
        <VideoLightboxModal
          videos={filteredVideos}
          currentIndex={previewVideoIndex}
          isSelected={selectedVideoIds.has(previewVideo.itemId)}
          downloadState={downloads[previewVideo.itemId]}
          onClose={() => setPreviewVideoId(null)}
          onNavigate={(index) => {
            const next = filteredVideos[index];
            if (next) setPreviewVideoId(next.itemId);
          }}
          onToggleSelect={(id) => void toggleSelection(id, 'video')}
          onDownload={(itemId) => void enqueueDownloads([itemId])}
          onCancelDownload={(itemId) => void cancelDownload(itemId)}
          onSelectVariant={selectVariant}
          onReportVideoMetadata={reportVideoMetadata}
          onSaveCapturedFrame={saveCapturedFrame}
        />
      )}
    </div>
  );
}

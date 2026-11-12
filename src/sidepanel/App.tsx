import { useCallback, useMemo, useState } from 'react';
import type { ImageItem, TabSessionSnapshot, VideoItem } from '@shared/types';
import { formatByteSize, getActiveVideoVariant } from '@shared/video-utils';
import { DownloadFooter } from './components/DownloadFooter';
import { EmptyOrStatusView } from './components/EmptyOrStatusView';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { ImageGrid } from './components/ImageGrid';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { MediaModeTabs } from './components/MediaModeTabs';
import { ScanTools } from './components/ScanTools';
import { SelectionToolbar } from './components/SelectionToolbar';
import { VideoFilterBar } from './components/VideoFilterBar';
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
  const selectedImageIds = useMemo(() => new Set(snapshot?.selectedIds), [snapshot?.selectedIds]);
  const selectedVideoIds = useMemo(() => new Set(snapshot?.selectedVideoIds), [snapshot?.selectedVideoIds]);

  const imageSortSelection = imagePrefs.sortOrder === 'selected_first' ? selectedImageIds : undefined;
  const videoSortSelection = videoPrefs.sortOrder === 'selected_first' ? selectedVideoIds : undefined;
  const { filteredItems, unknownDimensionIds } = useMemo(
    () => getImageView(rawItems, imagePrefs.filter, imagePrefs.sortOrder, imageSortSelection),
    [rawItems, imagePrefs.filter, imagePrefs.sortOrder, imageSortSelection],
  );
  const canSelectImage = useCallback(
    (item: ImageItem) => !unknownDimensionIds.has(item.itemId),
    [unknownDimensionIds],
  );
  const selectableImages = useMemo(
    () => unknownDimensionIds.size > 0 ? filteredItems.filter(canSelectImage) : filteredItems,
    [filteredItems, canSelectImage, unknownDimensionIds],
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

  const activeHeaderCount = mediaMode === 'video' ? rawVideos.length : rawItems.length;

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
        backgroundColor: 'var(--color-bg-app)',
        color: 'var(--color-text-primary)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      <Header
        domain={snapshot?.domain}
        pageTitle={snapshot?.pageTitle}
        itemCount={activeHeaderCount}
        scanStatus={scanStatus}
        statusMessage={snapshot?.statusMessage}
        onRescan={triggerRescan}
        isPinned={isPinned}
        onTogglePin={togglePin}
      />

      {!isGlobalBlockedStatus && (
        <MediaModeTabs
          activeMode={mediaMode}
          onChangeMode={setMediaMode}
          imageCount={rawItems.length}
          videoCount={rawVideos.length}
          selectedImageCount={imageSelection.visibleSelectedCount}
          selectedVideoCount={selectedVideoIds.size}
        />
      )}

      {mediaMode === 'image' ? (
        <>
          {!isGlobalBlockedStatus && (
            <>
              <ScanTools snapshot={snapshot} enabled={isPanelVisible} />
              <FilterBar
                filter={imagePrefs.filter}
                onChange={imagePrefs.setFilter}
                sortOrder={imagePrefs.sortOrder}
                onSortChange={imagePrefs.setSortOrder}
                onReset={imagePrefs.resetFilter}
                unknownDimensionsCount={unknownDimensionIds.size}
              />

              <SelectionToolbar
                mediaMode="image"
                selectedCount={imageSelection.visibleSelectedCount}
                hiddenSelectedCount={imageSelection.hiddenSelectedCount}
                visibleCount={filteredItems.length}
                selectableVisibleCount={imageSelection.selectableCount}
                visibleSelectedCount={imageSelection.visibleSelectedCount}
                hasVariants={hasImageVariants}
                cardSize={imagePrefs.cardSize}
                onCardSizeChange={imagePrefs.setCardSize}
                autoSelectAll={imagePrefs.autoSelectAll}
                onAutoSelectAllChange={imagePrefs.setAutoSelectAll}
                onSelectVisible={imageSelection.onSelectVisible}
                onDeselectVisible={imageSelection.onDeselectVisible}
                onClearAll={() => void clearAllSelection('image')}
                onDownloadSelected={() => void enqueueDownloads(imageSelection.visibleSelectedIds)}
                onApplyVariantPreference={(target) =>
                  void batchSelectVariants(target, filteredItems.map((item) => item.itemId), 'image')
                }
              />
            </>
          )}

          {showImageEmptyView ? (
            <EmptyOrStatusView
              mediaMode="image"
              scanStatus={scanStatus}
              statusMessage={snapshot?.statusMessage}
              isFilterEmpty={rawItems.length > 0 && filteredItems.length === 0}
              onClearFilter={imagePrefs.resetFilter}
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
          {!isGlobalBlockedStatus && (
            <>
              <VideoFilterBar
                filter={videoPrefs.filter}
                onChange={videoPrefs.setFilter}
                sortOrder={videoPrefs.sortOrder}
                onSortChange={videoPrefs.setSortOrder}
                onReset={videoPrefs.resetFilter}
                unknownMetadataCount={unknownVideoMetadataCount}
                unprobedCount={unprobedVideoCount}
                isProbing={isVideoProbing}
                probeProgress={videoProbeProgress}
                onStartProbing={() => void startVideoProbing()}
                onStopProbing={stopVideoProbing}
              />

              <SelectionToolbar
                mediaMode="video"
                selectedCount={selectedVideoIds.size}
                hiddenSelectedCount={videoSelection.hiddenSelectedCount}
                visibleCount={filteredVideos.length}
                selectableVisibleCount={videoSelection.selectableCount}
                visibleSelectedCount={videoSelection.visibleSelectedCount}
                hasVariants={hasVideoVariants}
                cardSize={videoPrefs.cardSize}
                onCardSizeChange={videoPrefs.setCardSize}
                onSelectVisible={videoSelection.onSelectVisible}
                onDeselectVisible={videoSelection.onDeselectVisible}
                onClearAll={() => void clearAllSelection('video')}
                onDownloadSelected={handleBatchVideoDownload}
                onApplyVariantPreference={(target) =>
                  void batchSelectVariants(target, videoSelection.visibleIds, 'video')
                }
              />
            </>
          )}

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

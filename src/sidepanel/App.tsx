import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractFilenameForSort } from '@shared/filename-utils';
import type {
  CardSize,
  FilterState,
  ImageItem,
  MediaMode,
  SortOrder,
  VideoFilterState,
  VideoItem,
  VideoSortOrder,
} from '@shared/types';
import {
  extractResolutionHint,
  formatByteSize,
  getActiveVideoVariant,
  matchesMinResolutionTier,
} from '@shared/video-utils';
import { DownloadFooter } from './components/DownloadFooter';
import { EmptyOrStatusView } from './components/EmptyOrStatusView';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { ScanTools } from './components/ScanTools';
import { ImageGrid } from './components/ImageGrid';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { MediaModeTabs } from './components/MediaModeTabs';
import { SelectionToolbar } from './components/SelectionToolbar';
import { VideoFilterBar } from './components/VideoFilterBar';
import { VideoGrid } from './components/VideoGrid';
import { VideoLightboxModal } from './components/VideoLightboxModal';
import { useActiveTabId } from './hooks/useActiveTabId';
import { usePanelActivity } from './hooks/usePanelActivity';
import { useBlobStreamBridge } from './hooks/useBlobStreamBridge';
import { useTabSession } from './hooks/useTabSession';
import { useVideoMetadataProber } from './hooks/useVideoMetadataProber';

const DEFAULT_IMAGE_FILTER: FilterState = {
  urlQuery: '',
  minWidth: null,
  minHeight: null,
  formats: [],
  includeUnknownDimensions: false,
};

const DEFAULT_VIDEO_FILTER: VideoFilterState = {
  urlQuery: '',
  minResolution: 'all',
  durationRange: 'all',
  minDurationSec: null,
  formats: [],
  onlyReadyToDownload: false,
  includeUnknownMetadata: false,
};

const FILTER_PREFS_KEY = 'wic_filter_preferences';
const VIDEO_FILTER_PREFS_KEY = 'wic_video_filter_preferences';

interface SavedFilterPreferences {
  minWidth: number | null;
  minHeight: number | null;
  formats: FilterState['formats'];
  includeUnknownDimensions: boolean;
}

interface SavedVideoFilterPreferences {
  minResolution: VideoFilterState['minResolution'];
  durationRange: VideoFilterState['durationRange'];
  formats: VideoFilterState['formats'];
  onlyReadyToDownload: boolean;
  includeUnknownMetadata: boolean;
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

function loadSavedVideoFilterPreferences(): Partial<VideoFilterState> {
  try {
    const raw = localStorage.getItem(VIDEO_FILTER_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        minResolution:
          parsed.minResolution === '4k' ||
          parsed.minResolution === '1080p' ||
          parsed.minResolution === '720p'
            ? parsed.minResolution
            : 'all',
        durationRange:
          parsed.durationRange === 'short' ||
          parsed.durationRange === 'medium' ||
          parsed.durationRange === 'long'
            ? parsed.durationRange
            : 'all',
        formats: Array.isArray(parsed.formats) ? parsed.formats : [],
        onlyReadyToDownload: Boolean(parsed.onlyReadyToDownload),
        includeUnknownMetadata: Boolean(parsed.includeUnknownMetadata),
      };
    }
  } catch {}
  return {};
}

function saveVideoFilterPreferences(filter: VideoFilterState): void {
  try {
    const prefs: SavedVideoFilterPreferences = {
      minResolution: filter.minResolution,
      durationRange: filter.durationRange,
      formats: filter.formats,
      onlyReadyToDownload: filter.onlyReadyToDownload,
      includeUnknownMetadata: filter.includeUnknownMetadata,
    };
    localStorage.setItem(VIDEO_FILTER_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
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

  const {
    isProbing: isVideoProbing,
    progress: videoProbeProgress,
    startProbing: startVideoProbing,
    stopProbing: stopVideoProbing,
    unprobedCount: unprobedVideoCount,
  } = useVideoMetadataProber({
    videos: snapshot?.videos ?? [],
    onReportVideoMetadata: reportVideoMetadata,
    targetTabId: activeTabId,
    enabled: isPanelVisible,
  });

  // Active Mode ('image' | 'video')
  const [mediaMode, setMediaModeState] = useState<MediaMode>(() => {
    try {
      const saved = localStorage.getItem('wic_media_mode');
      if (saved === 'video' || saved === 'image') return saved;
    } catch {}
    return 'image';
  });

  const handleChangeMediaMode = useCallback((mode: MediaMode) => {
    setMediaModeState(mode);
    try {
      localStorage.setItem('wic_media_mode', mode);
    } catch {}
  }, []);

  // ---------------- Image Mode States ----------------
  const [filter, setFilterState] = useState<FilterState>(() => {
    const saved = loadSavedFilterPreferences();
    return {
      urlQuery: '',
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
    setFilterState(DEFAULT_IMAGE_FILTER);
    saveFilterPreferences(DEFAULT_IMAGE_FILTER);
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

  const [cardSize, setCardSize] = useState<CardSize>(() => {
    try {
      const saved = localStorage.getItem('wic_card_size');
      if (saved === 'auto' || saved === 'small' || saved === 'medium' || saved === 'large') {
        return saved;
      }
    } catch {}
    return 'auto';
  });

  const handleCardSizeChange = useCallback((size: CardSize) => {
    setCardSize(size);
    try {
      localStorage.setItem('wic_card_size', size);
    } catch {}
  }, []);

  // ---------------- Video Mode States ----------------
  const [videoFilter, setVideoFilterState] = useState<VideoFilterState>(() => {
    const saved = loadSavedVideoFilterPreferences();
    return {
      urlQuery: '',
      minResolution: saved.minResolution ?? 'all',
      durationRange: saved.durationRange ?? 'all',
      minDurationSec: null,
      formats: saved.formats ?? [],
      onlyReadyToDownload: saved.onlyReadyToDownload ?? false,
      includeUnknownMetadata: saved.includeUnknownMetadata ?? false,
    };
  });

  const handleVideoFilterChange = useCallback((next: VideoFilterState) => {
    setVideoFilterState(next);
    saveVideoFilterPreferences(next);
  }, []);

  const handleResetVideoFilter = useCallback(() => {
    setVideoFilterState(DEFAULT_VIDEO_FILTER);
    saveVideoFilterPreferences(DEFAULT_VIDEO_FILTER);
  }, []);

  const [videoSortOrder, setVideoSortOrder] = useState<VideoSortOrder>(() => {
    try {
      const saved = localStorage.getItem('wic_video_sort_order') as VideoSortOrder | null;
      if (saved) return saved;
    } catch {}
    return 'position_asc';
  });

  const handleVideoSortChange = useCallback((nextOrder: VideoSortOrder) => {
    setVideoSortOrder(nextOrder);
    try {
      localStorage.setItem('wic_video_sort_order', nextOrder);
    } catch {}
  }, []);

  const [videoCardSize, setVideoCardSize] = useState<CardSize>(() => {
    try {
      const saved = localStorage.getItem('wic_video_card_size');
      if (saved === 'auto' || saved === 'small' || saved === 'medium' || saved === 'large') {
        return saved;
      }
    } catch {}
    return 'auto';
  });

  const handleVideoCardSizeChange = useCallback((size: CardSize) => {
    setVideoCardSize(size);
    try {
      localStorage.setItem('wic_video_card_size', size);
    } catch {}
  }, []);

  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  const rawItems = snapshot?.items || [];
  const rawVideos = snapshot?.videos || [];

  const selectedIdsSet = useMemo(
    () => new Set(snapshot?.selectedIds || []),
    [snapshot?.selectedIds],
  );
  const selectedVideoIdsSet = useMemo(
    () => new Set(snapshot?.selectedVideoIds || []),
    [snapshot?.selectedVideoIds],
  );

  // ---------------- Filtered & Sorted Images ----------------
  const hasDimensionFilter = (filter.minWidth ?? 0) > 0 || (filter.minHeight ?? 0) > 0;

  const { filteredItems, unknownDimensionsCount } = useMemo(() => {
    let unknownCount = 0;
    const query = filter.urlQuery.trim().toLowerCase();

    const matched = rawItems.filter((item: ImageItem) => {
      const activeVariant =
        item.variants.find((v) => v.url === item.selectedUrl) || item.variants[0];

      if (query && !item.selectedUrl.toLowerCase().includes(query)) {
        return false;
      }

      if (filter.formats.length > 0) {
        const fmt = activeVariant?.format || 'unknown';
        if (!filter.formats.includes(fmt)) {
          return false;
        }
      }

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
          } else if (aPixels !== null) return -1;
          else if (bPixels !== null) return 1;
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
          } else if (aPixels !== null) return -1;
          else if (bPixels !== null) return 1;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'filename_asc': {
          const aName = extractFilenameForSort(a.selectedUrl);
          const bName = extractFilenameForSort(b.selectedUrl);
          const cmp = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
          return cmp !== 0 ? cmp : a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'filename_desc': {
          const aName = extractFilenameForSort(a.selectedUrl);
          const bName = extractFilenameForSort(b.selectedUrl);
          const cmp = bName.localeCompare(aName, undefined, { numeric: true, sensitivity: 'base' });
          return cmp !== 0 ? cmp : a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'selected_first': {
          const aSelected = selectedIdsSet.has(a.itemId) ? 1 : 0;
          const bSelected = selectedIdsSet.has(b.itemId) ? 1 : 0;
          if (aSelected !== bSelected) return bSelected - aSelected;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        default:
          return a.firstSeenOrder - b.firstSeenOrder;
      }
    });

    return { filteredItems: sorted, unknownDimensionsCount: unknownCount };
  }, [rawItems, filter, hasDimensionFilter, sortOrder, selectedIdsSet]);

  // ---------------- Filtered & Sorted Videos ----------------
  const { filteredVideos, unknownVideoMetadataCount } = useMemo(() => {
    let unknownCount = 0;
    const query = videoFilter.urlQuery.trim().toLowerCase();

    const matched = rawVideos.filter((video: VideoItem) => {
      const activeVar = getActiveVideoVariant(video.variants, video.selectedUrl);

      if (query) {
        const hayUrl = video.selectedUrl.toLowerCase();
        const hayName = extractFilenameForSort(video.selectedUrl).toLowerCase();
        if (!hayUrl.includes(query) && !hayName.includes(query)) {
          return false;
        }
      }

      if (videoFilter.onlyReadyToDownload && activeVar?.readiness !== 'ready') {
        return false;
      }

      if (videoFilter.formats.length > 0) {
        const fmt = activeVar?.format || 'unknown';
        if (!videoFilter.formats.includes(fmt)) {
          return false;
        }
      }

      let hadUnknownMeta = false;

      if (videoFilter.minResolution !== 'all') {
        const resCheck = matchesMinResolutionTier(
          activeVar?.videoWidth,
          activeVar?.videoHeight,
          videoFilter.minResolution,
        );
        if (resCheck === 'unknown') {
          hadUnknownMeta = true;
        } else if (!resCheck) {
          return false;
        }
      }

      if (videoFilter.durationRange !== 'all') {
        const dur = video.durationSec;
        if (dur === null || dur === undefined || !Number.isFinite(dur)) {
          hadUnknownMeta = true;
        } else {
          if (videoFilter.durationRange === 'short' && dur >= 60) return false;
          if (videoFilter.durationRange === 'medium' && (dur < 60 || dur > 600)) return false;
          if (videoFilter.durationRange === 'long' && dur <= 600) return false;
        }
      }

      if (hadUnknownMeta) {
        unknownCount++;
        if (!videoFilter.includeUnknownMetadata) {
          return false;
        }
      }

      return true;
    });

    const sorted = [...matched].sort((a, b) => {
      const aVar = getActiveVideoVariant(a.variants, a.selectedUrl);
      const bVar = getActiveVideoVariant(b.variants, b.selectedUrl);

      switch (videoSortOrder) {
        case 'position_asc':
          return a.firstSeenOrder - b.firstSeenOrder;
        case 'position_desc':
          return b.firstSeenOrder - a.firstSeenOrder;
        case 'resolution_desc':
        case 'resolution_asc': {
          const getVideoArea = (vUrl: string, v?: typeof aVar) => {
            if (v?.videoWidth && v?.videoHeight) return v.videoWidth * v.videoHeight;
            for (const d of v?.descriptors ?? []) {
              const hint = extractResolutionHint(d);
              if (hint && hint.area > 0) return hint.area;
            }
            const urlHint = extractResolutionHint(vUrl);
            if (urlHint && urlHint.area > 0) return urlHint.area;
            return null;
          };

          const aArea = getVideoArea(a.selectedUrl, aVar);
          const bArea = getVideoArea(b.selectedUrl, bVar);
          if (aArea !== null && bArea !== null && aArea !== bArea) {
            return videoSortOrder === 'resolution_desc' ? bArea - aArea : aArea - bArea;
          }
          if (aArea !== null && bArea === null) return -1;
          if (aArea === null && bArea !== null) return 1;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'duration_desc':
        case 'duration_asc': {
          const aDur = a.durationSec;
          const bDur = b.durationSec;
          if (aDur !== null && bDur !== null && aDur !== bDur) {
            return videoSortOrder === 'duration_desc' ? bDur - aDur : aDur - bDur;
          }
          if (aDur !== null && bDur === null) return -1;
          if (aDur === null && bDur !== null) return 1;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'filesize_desc': {
          const aSize = aVar?.fileSizeBytes ?? null;
          const bSize = bVar?.fileSizeBytes ?? null;
          if (aSize !== null && bSize !== null && aSize !== bSize) {
            return bSize - aSize;
          }
          if (aSize !== null && bSize === null) return -1;
          if (aSize === null && bSize !== null) return 1;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'filename_asc': {
          const aName = extractFilenameForSort(a.selectedUrl);
          const bName = extractFilenameForSort(b.selectedUrl);
          const cmp = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
          return cmp !== 0 ? cmp : a.firstSeenOrder - b.firstSeenOrder;
        }
        case 'selected_first': {
          const aSel = selectedVideoIdsSet.has(a.itemId) ? 1 : 0;
          const bSel = selectedVideoIdsSet.has(b.itemId) ? 1 : 0;
          if (aSel !== bSel) return bSel - aSel;
          return a.firstSeenOrder - b.firstSeenOrder;
        }
        default:
          return a.firstSeenOrder - b.firstSeenOrder;
      }
    });

    return { filteredVideos: sorted, unknownVideoMetadataCount: unknownCount };
  }, [rawVideos, videoFilter, videoSortOrder, selectedVideoIdsSet]);

  // ---------------- Derived Selection & Preview Computations ----------------
  const visibleItemIds = useMemo(() => filteredItems.map((i) => i.itemId), [filteredItems]);
  const visibleItemIdsSet = useMemo(() => new Set(visibleItemIds), [visibleItemIds]);

  const visibleVideoIds = useMemo(() => filteredVideos.map((v) => v.itemId), [filteredVideos]);
  const visibleVideoIdsSet = useMemo(() => new Set(visibleVideoIds), [visibleVideoIds]);

  // Only videos passing Readiness Gate ('ready') are eligible for "表示中を全選択"
  const selectableVisibleVideoIds = useMemo(
    () =>
      filteredVideos
        .filter((v) => getActiveVideoVariant(v.variants, v.selectedUrl)?.readiness === 'ready')
        .map((v) => v.itemId),
    [filteredVideos],
  );

  const hiddenSelectedImageCount = useMemo(() => {
    let count = 0;
    for (const id of selectedIdsSet) {
      if (!visibleItemIdsSet.has(id)) count++;
    }
    return count;
  }, [selectedIdsSet, visibleItemIdsSet]);

  const hiddenSelectedVideoCount = useMemo(() => {
    let count = 0;
    for (const id of selectedVideoIdsSet) {
      if (!visibleVideoIdsSet.has(id)) count++;
    }
    return count;
  }, [selectedVideoIdsSet, visibleVideoIdsSet]);

  const visibleSelectedImageIds = useMemo(
    () => visibleItemIds.filter((id) => selectedIdsSet.has(id)),
    [visibleItemIds, selectedIdsSet],
  );
  const visibleSelectedVideoIds = useMemo(
    () => visibleVideoIds.filter((id) => selectedVideoIdsSet.has(id)),
    [visibleVideoIds, selectedVideoIdsSet],
  );

  const lastSelectedImageIdRef = useRef<string | null>(null);
  const lastSelectedVideoIdRef = useRef<string | null>(null);

  // Reset shift-click anchor whenever active tab or media mode changes
  useEffect(() => {
    lastSelectedImageIdRef.current = null;
    lastSelectedVideoIdRef.current = null;
  }, [activeTabId, mediaMode]);

  const handleToggleImageSelect = useCallback(
    (targetId: string, e?: React.MouseEvent) => {
      const isShift = Boolean(e?.shiftKey);
      const lastId = lastSelectedImageIdRef.current;
      lastSelectedImageIdRef.current = targetId;

      if (isShift && lastId && lastId !== targetId) {
        const fromIdx = filteredItems.findIndex((item) => item.itemId === lastId);
        const toIdx = filteredItems.findIndex((item) => item.itemId === targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const start = Math.min(fromIdx, toIdx);
          const end = Math.max(fromIdx, toIdx);
          const rangeIds = filteredItems.slice(start, end + 1).map((item) => item.itemId);

          const shouldSelect = selectedIdsSet.has(lastId) || !selectedIdsSet.has(targetId);
          if (shouldSelect) {
            void selectAllVisible(rangeIds, 'image');
          } else {
            void deselectVisible(rangeIds, 'image');
          }
          return;
        }
      }

      void toggleSelection(targetId, 'image');
    },
    [filteredItems, selectedIdsSet, selectAllVisible, deselectVisible, toggleSelection],
  );

  const handleToggleVideoSelect = useCallback(
    (targetId: string, e?: React.MouseEvent) => {
      const isShift = Boolean(e?.shiftKey);
      const lastId = lastSelectedVideoIdRef.current;
      lastSelectedVideoIdRef.current = targetId;

      if (isShift && lastId && lastId !== targetId) {
        const fromIdx = filteredVideos.findIndex((v) => v.itemId === lastId);
        const toIdx = filteredVideos.findIndex((v) => v.itemId === targetId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const start = Math.min(fromIdx, toIdx);
          const end = Math.max(fromIdx, toIdx);
          const rangeVideos = filteredVideos.slice(start, end + 1);
          const selectableRangeIds = rangeVideos
            .filter((v) => getActiveVideoVariant(v.variants, v.selectedUrl)?.readiness === 'ready')
            .map((v) => v.itemId);

          const shouldSelect = selectedVideoIdsSet.has(lastId) || !selectedVideoIdsSet.has(targetId);
          if (shouldSelect) {
            void selectAllVisible(selectableRangeIds, 'video');
          } else {
            void deselectVisible(selectableRangeIds, 'video');
          }
          return;
        }
      }

      void toggleSelection(targetId, 'video');
    },
    [filteredVideos, selectedVideoIdsSet, selectAllVisible, deselectVisible, toggleSelection],
  );

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
    const ids = Array.from(selectedVideoIdsSet);
    if (ids.length === 0) return;

    // Safety confirmation for heavy multi-video batch downloads (5+ videos or >=300MB known size)
    let knownTotalBytes = 0;
    for (const v of rawVideos) {
      if (selectedVideoIdsSet.has(v.itemId)) {
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
  }, [selectedVideoIdsSet, rawVideos, enqueueDownloads]);

  const handleCancelActiveDownloads = useCallback(
    (itemIds: string[]) => {
      for (const id of itemIds) {
        void cancelDownload(id);
      }
    },
    [cancelDownload],
  );

  const scanStatus = snapshot?.scanStatus || 'unscanned';
  const isGlobalBlockedStatus = scanStatus === 'unscanned' || scanStatus === 'restricted';

  const showImageEmptyView =
    isGlobalBlockedStatus ||
    (filteredItems.length === 0 && rawItems.length === 0) ||
    filteredItems.length === 0;

  const showVideoEmptyView =
    isGlobalBlockedStatus ||
    (filteredVideos.length === 0 && rawVideos.length === 0) ||
    filteredVideos.length === 0;

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
          onChangeMode={handleChangeMediaMode}
          imageCount={rawItems.length}
          videoCount={rawVideos.length}
          selectedImageCount={selectedIdsSet.size}
          selectedVideoCount={selectedVideoIdsSet.size}
        />
      )}

      {mediaMode === 'image' ? (
        <>
          {!isGlobalBlockedStatus && (
            <>
              <ScanTools snapshot={snapshot} enabled={isPanelVisible} />
              <FilterBar
                filter={filter}
                onChange={handleFilterChange}
                sortOrder={sortOrder}
                onSortChange={handleSortChange}
                onReset={handleResetFilter}
                unknownDimensionsCount={unknownDimensionsCount}
              />

              <SelectionToolbar
                mediaMode="image"
                selectedCount={selectedIdsSet.size}
                hiddenSelectedCount={hiddenSelectedImageCount}
                visibleCount={filteredItems.length}
                visibleSelectedCount={visibleSelectedImageIds.length}
                hasVariants={hasImageVariants}
                cardSize={cardSize}
                onCardSizeChange={handleCardSizeChange}
                onSelectVisible={() => void selectAllVisible(visibleItemIds, 'image')}
                onDeselectVisible={() => void deselectVisible(visibleSelectedImageIds, 'image')}
                onClearAll={() => void clearAllSelection('image')}
                onDownloadSelected={() => void enqueueDownloads(Array.from(selectedIdsSet))}
                onApplyVariantPreference={(target) =>
                  void batchSelectVariants(target, visibleItemIds, 'image')
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
              onClearFilter={handleResetFilter}
              onRescan={triggerRescan}
            />
          ) : (
            <ImageGrid
              items={filteredItems}
              selectedIds={selectedIdsSet}
              downloads={snapshot?.downloads || {}}
              cardSize={cardSize}
              onToggleSelect={handleToggleImageSelect}
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
                filter={videoFilter}
                onChange={handleVideoFilterChange}
                sortOrder={videoSortOrder}
                onSortChange={handleVideoSortChange}
                onReset={handleResetVideoFilter}
                unknownMetadataCount={unknownVideoMetadataCount}
                unprobedCount={unprobedVideoCount}
                isProbing={isVideoProbing}
                probeProgress={videoProbeProgress}
                onStartProbing={() => void startVideoProbing()}
                onStopProbing={stopVideoProbing}
              />

              <SelectionToolbar
                mediaMode="video"
                selectedCount={selectedVideoIdsSet.size}
                hiddenSelectedCount={hiddenSelectedVideoCount}
                visibleCount={filteredVideos.length}
                selectableVisibleCount={selectableVisibleVideoIds.length}
                visibleSelectedCount={visibleSelectedVideoIds.length}
                hasVariants={hasVideoVariants}
                cardSize={videoCardSize}
                onCardSizeChange={handleVideoCardSizeChange}
                onSelectVisible={() =>
                  void selectAllVisible(selectableVisibleVideoIds, 'video')
                }
                onDeselectVisible={() => void deselectVisible(visibleSelectedVideoIds, 'video')}
                onClearAll={() => void clearAllSelection('video')}
                onDownloadSelected={handleBatchVideoDownload}
                onApplyVariantPreference={(target) =>
                  void batchSelectVariants(target, visibleVideoIds, 'video')
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
              onClearFilter={handleResetVideoFilter}
              onRescan={triggerRescan}
            />
          ) : (
            <VideoGrid
              isActive={isPanelVisible}
              videos={filteredVideos}
              selectedVideoIds={selectedVideoIdsSet}
              downloads={snapshot?.downloads || {}}
              cardSize={videoCardSize}
              onToggleSelect={handleToggleVideoSelect}
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
        downloads={snapshot?.downloads || {}}
        onRetryFailed={() => void retryFailedDownloads(undefined, mediaMode)}
        onCancelActive={handleCancelActiveDownloads}
      />

      {mediaMode === 'image' && previewItem && (
        <ImageLightboxModal
          items={filteredItems}
          currentIndex={previewItemIndex}
          isSelected={selectedIdsSet.has(previewItem.itemId)}
          downloadState={snapshot?.downloads[previewItem.itemId]}
          onClose={() => setPreviewItemId(null)}
          onNavigate={(index) => {
            const next = filteredItems[index];
            if (next) setPreviewItemId(next.itemId);
          }}
          onToggleSelect={(id) => void toggleSelection(id, 'image')}
          onDownload={(itemId) => void enqueueDownloads([itemId])}
          onSelectVariant={selectVariant}
        />
      )}

      {isPanelVisible && mediaMode === 'video' && previewVideo && (
        <VideoLightboxModal
          videos={filteredVideos}
          currentIndex={previewVideoIndex}
          isSelected={selectedVideoIdsSet.has(previewVideo.itemId)}
          downloadState={snapshot?.downloads[previewVideo.itemId]}
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

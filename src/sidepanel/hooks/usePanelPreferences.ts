import { useCallback, useState } from 'react';
import type { CardSize, FilterState, MediaMode, SortOrder, VideoFilterState, VideoSortOrder } from '@shared/types';

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

const CARD_SIZES: readonly CardSize[] = ['auto', 'small', 'medium', 'large'];
const IMAGE_SORT_ORDERS: readonly SortOrder[] = [
  'position_asc', 'position_desc', 'size_desc', 'size_asc', 'filename_asc', 'filename_desc', 'selected_first',
];
const VIDEO_SORT_ORDERS: readonly VideoSortOrder[] = [
  'position_asc', 'position_desc', 'resolution_desc', 'resolution_asc',
  'duration_desc', 'duration_asc', 'filesize_desc', 'filename_asc', 'selected_first',
];

function useStoredPreference<T>(
  key: string,
  fallback: T,
  parse: (saved: string) => T,
  serialize: (value: T) => string = String,
) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return parse(saved);
    } catch {
      // The panel can still use its defaults if storage is unavailable or invalid.
    }
    return fallback;
  });

  const update = useCallback((next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, serialize(next));
    } catch {
      // A failed save does not undo the change in the current panel.
    }
  }, [key, serialize]);

  return [value, update] as const;
}

function useStoredChoice<T extends string>(key: string, fallback: T, choices: readonly T[]) {
  return useStoredPreference(key, fallback, (saved) => choices.find((choice) => choice === saved) ?? fallback);
}

function parseMinimumSize(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

function parseImageFilter(raw: string): FilterState {
  const saved = JSON.parse(raw) as Partial<FilterState> | null;
  return {
    ...DEFAULT_IMAGE_FILTER,
    minWidth: parseMinimumSize(saved?.minWidth),
    minHeight: parseMinimumSize(saved?.minHeight),
    formats: Array.isArray(saved?.formats) ? saved.formats : [],
    includeUnknownDimensions: Boolean(saved?.includeUnknownDimensions),
  };
}

function serializeImageFilter({ minWidth, minHeight, formats, includeUnknownDimensions }: FilterState): string {
  return JSON.stringify({ minWidth, minHeight, formats, includeUnknownDimensions });
}

function parseVideoFilter(raw: string): VideoFilterState {
  const saved = JSON.parse(raw) as Partial<VideoFilterState> | null;
  const minResolution = saved?.minResolution;
  const durationRange = saved?.durationRange;
  return {
    ...DEFAULT_VIDEO_FILTER,
    minResolution: minResolution === '4k' || minResolution === '1080p' || minResolution === '720p'
      ? minResolution : 'all',
    durationRange: durationRange === 'short' || durationRange === 'medium' || durationRange === 'long'
      ? durationRange : 'all',
    formats: Array.isArray(saved?.formats) ? saved.formats : [],
    onlyReadyToDownload: Boolean(saved?.onlyReadyToDownload),
    includeUnknownMetadata: Boolean(saved?.includeUnknownMetadata),
  };
}

function serializeVideoFilter({
  minResolution, durationRange, formats, onlyReadyToDownload, includeUnknownMetadata,
}: VideoFilterState): string {
  return JSON.stringify({ minResolution, durationRange, formats, onlyReadyToDownload, includeUnknownMetadata });
}

export function usePanelPreferences() {
  const [mediaMode, setMediaMode] = useStoredChoice<MediaMode>('wic_media_mode', 'image', ['image', 'video']);
  const [imageSortOrder, setImageSortOrder] = useStoredChoice('wic_sort_order', 'position_asc', IMAGE_SORT_ORDERS);
  const [videoSortOrder, setVideoSortOrder] = useStoredChoice('wic_video_sort_order', 'position_asc', VIDEO_SORT_ORDERS);
  const [imageCardSize, setImageCardSize] = useStoredChoice('wic_card_size', 'auto', CARD_SIZES);
  const [videoCardSize, setVideoCardSize] = useStoredChoice('wic_video_card_size', 'auto', CARD_SIZES);
  const [imageFilter, setImageFilter] = useStoredPreference(
    'wic_filter_preferences', DEFAULT_IMAGE_FILTER, parseImageFilter, serializeImageFilter,
  );
  const [videoFilter, setVideoFilter] = useStoredPreference(
    'wic_video_filter_preferences', DEFAULT_VIDEO_FILTER, parseVideoFilter, serializeVideoFilter,
  );
  const [imageAutoSelectAll, setImageAutoSelectAll] = useStoredPreference<boolean>(
    'wic_image_auto_select_all',
    true,
    (saved) => saved === 'true',
    (value) => String(value),
  );
  const resetImageFilter = useCallback(() => setImageFilter(DEFAULT_IMAGE_FILTER), [setImageFilter]);
  const resetVideoFilter = useCallback(() => setVideoFilter(DEFAULT_VIDEO_FILTER), [setVideoFilter]);

  return {
    mediaMode,
    setMediaMode,
    image: {
      filter: imageFilter, setFilter: setImageFilter, resetFilter: resetImageFilter,
      sortOrder: imageSortOrder, setSortOrder: setImageSortOrder,
      cardSize: imageCardSize, setCardSize: setImageCardSize,
      autoSelectAll: imageAutoSelectAll, setAutoSelectAll: setImageAutoSelectAll,
    },
    video: {
      filter: videoFilter, setFilter: setVideoFilter, resetFilter: resetVideoFilter,
      sortOrder: videoSortOrder, setSortOrder: setVideoSortOrder,
      cardSize: videoCardSize, setCardSize: setVideoCardSize,
    },
  };
}

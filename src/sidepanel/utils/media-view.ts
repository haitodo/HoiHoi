import { extractFilenameForSort } from '@shared/filename-utils';
import type { FilterState, ImageItem, SortOrder, VideoFilterState, VideoItem, VideoSortOrder } from '@shared/types';
import { extractResolutionHint, getActiveVideoVariant, matchesMinResolutionTier } from '@shared/video-utils';

type MediaItem = Pick<ImageItem, 'itemId' | 'selectedUrl' | 'firstSeenOrder'>;

const filenameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareFirstSeen(a: MediaItem, b: MediaItem): number {
  return a.firstSeenOrder - b.firstSeenOrder;
}

function sortByKey<T extends MediaItem, K>(
  items: readonly T[],
  getKey: (item: T) => K,
  compareKeys: (a: K, b: K) => number,
): T[] {
  // Extract each key once; filenames and resolution hints can be expensive to parse.
  return items.map((item) => ({ item, key: getKey(item) }))
    .sort((a, b) => {
      const order = compareKeys(a.key, b.key);
      return order === 0 ? compareFirstSeen(a.item, b.item) : order;
    })
    .map(({ item }) => item);
}

function sortByNumber<T extends MediaItem>(
  items: readonly T[],
  getValue: (item: T) => number | null,
  descending: boolean,
): T[] {
  return sortByKey(items, getValue, (a, b) => {
    if (a === b) return 0;
    // Unknown values stay at the end in either direction.
    if (a === null) return 1;
    if (b === null) return -1;
    return descending ? b - a : a - b;
  });
}

function sortByCommonOrder<T extends MediaItem>(
  items: T[],
  order: SortOrder | VideoSortOrder,
  selectedIds: ReadonlySet<string> | undefined,
): T[] {
  switch (order) {
    case 'position_desc':
      return items.sort((a, b) => compareFirstSeen(b, a));
    case 'filename_asc':
    case 'filename_desc':
      return sortByKey(items, (item) => extractFilenameForSort(item.selectedUrl), (a, b) =>
        order === 'filename_asc' ? filenameCollator.compare(a, b) : filenameCollator.compare(b, a),
      );
    case 'selected_first':
      return items.sort((a, b) => {
        const aSelected = Number(selectedIds?.has(a.itemId) ?? false);
        const bSelected = Number(selectedIds?.has(b.itemId) ?? false);
        return bSelected - aSelected || compareFirstSeen(a, b);
      });
    default:
      return items.sort(compareFirstSeen);
  }
}

function getImageVariant(item: ImageItem) {
  return item.variants.find((variant) => variant.url === item.selectedUrl) ?? item.variants[0];
}

function getImageArea(item: ImageItem): number | null {
  const variant = getImageVariant(item);
  return variant?.naturalWidth && variant.naturalHeight
    ? variant.naturalWidth * variant.naturalHeight
    : null;
}

export function getImageView(
  items: readonly ImageItem[],
  filter: FilterState,
  order: SortOrder,
  selectedIds?: ReadonlySet<string>,
) {
  const query = filter.urlQuery.trim().toLowerCase();
  const hasDimensionFilter = (filter.minWidth ?? 0) > 0 || (filter.minHeight ?? 0) > 0;
  const hasFormatFilter = filter.formats.length > 0;
  let unknownDimensionsCount = 0;

  const matched = items.filter((item) => {
    if (query && !item.selectedUrl.toLowerCase().includes(query)) return false;

    const variant = hasFormatFilter || hasDimensionFilter ? getImageVariant(item) : undefined;
    if (hasFormatFilter && !filter.formats.includes(variant?.format ?? 'unknown')) return false;
    if (!hasDimensionFilter) return true;

    const width = variant?.naturalWidth;
    const height = variant?.naturalHeight;
    if (width == null || height == null) {
      unknownDimensionsCount++;
      return filter.includeUnknownDimensions;
    }
    if (filter.minWidth && width < filter.minWidth) return false;
    if (filter.minHeight && height < filter.minHeight) return false;
    return true;
  });

  const filteredItems = order === 'size_asc' || order === 'size_desc'
    ? sortByNumber(matched, getImageArea, order === 'size_desc')
    : sortByCommonOrder(matched, order, selectedIds);
  return { filteredItems, unknownDimensionsCount };
}

function getVideoArea(video: VideoItem): number | null {
  const variant = getActiveVideoVariant(video.variants, video.selectedUrl);
  if (variant?.videoWidth && variant.videoHeight) return variant.videoWidth * variant.videoHeight;
  for (const descriptor of variant?.descriptors ?? []) {
    const hint = extractResolutionHint(descriptor);
    if (hint && hint.area > 0) return hint.area;
  }
  const hint = extractResolutionHint(video.selectedUrl);
  return hint && hint.area > 0 ? hint.area : null;
}

function sortVideos(matched: VideoItem[], order: VideoSortOrder, selectedIds: ReadonlySet<string> | undefined) {
  switch (order) {
    case 'resolution_asc':
    case 'resolution_desc':
      return sortByNumber(matched, getVideoArea, order === 'resolution_desc');
    case 'duration_asc':
    case 'duration_desc':
      return sortByNumber(matched, (video) => video.durationSec, order === 'duration_desc');
    case 'filesize_desc':
      return sortByNumber(matched, (video) =>
        getActiveVideoVariant(video.variants, video.selectedUrl)?.fileSizeBytes ?? null, true,
      );
    default:
      return sortByCommonOrder(matched, order, selectedIds);
  }
}

export function getVideoView(
  videos: readonly VideoItem[],
  filter: VideoFilterState,
  order: VideoSortOrder,
  selectedIds?: ReadonlySet<string>,
) {
  const query = filter.urlQuery.trim().toLowerCase();
  const { minResolution, durationRange, formats, onlyReadyToDownload } = filter;
  const needsVariant = onlyReadyToDownload || formats.length > 0 || minResolution !== 'all';
  let unknownVideoMetadataCount = 0;

  const matched = videos.filter((video) => {
    if (query && !video.selectedUrl.toLowerCase().includes(query) &&
      !extractFilenameForSort(video.selectedUrl).toLowerCase().includes(query)) return false;

    const variant = needsVariant ? getActiveVideoVariant(video.variants, video.selectedUrl) : undefined;
    if (onlyReadyToDownload && variant?.readiness !== 'ready') return false;
    if (formats.length > 0 && !formats.includes(variant?.format ?? 'unknown')) return false;

    let hasUnknownMetadata = false;
    if (minResolution !== 'all') {
      const resolution = matchesMinResolutionTier(variant?.videoWidth, variant?.videoHeight, minResolution);
      if (resolution === false) return false;
      hasUnknownMetadata = resolution === 'unknown';
    }

    if (durationRange !== 'all') {
      const duration = video.durationSec;
      if (duration == null || !Number.isFinite(duration)) {
        hasUnknownMetadata = true;
      } else {
        if (durationRange === 'short' && duration >= 60) return false;
        if (durationRange === 'medium' && (duration < 60 || duration > 600)) return false;
        if (durationRange === 'long' && duration <= 600) return false;
      }
    }

    if (hasUnknownMetadata) {
      unknownVideoMetadataCount++;
      return filter.includeUnknownMetadata;
    }
    return true;
  });

  return { filteredVideos: sortVideos(matched, order, selectedIds), unknownVideoMetadataCount };
}

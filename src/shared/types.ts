/**
 * Core domain types shared across Background Service Worker, Content Script, and Side Panel UI.
 * DO NOT diverge from these types without updating `design.md`.
 */

/** Canonical image formats supported for display and filtering (`spec.md` MVP-08, MVP-12). */
export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'svg'
  | 'avif'
  | 'bmp'
  | 'ico'
  | 'unknown';

/** Origin mechanism from which an image candidate was discovered (`spec.md` §6.1). */
export type DetectionSource =
  | 'img'
  | 'picture'
  | 'css-bg'
  | 'svg-image'
  | 'lazy-attr'
  | 'link-href'
  | 'video-poster';

/** Role of a candidate URL inside an `ImageItem.variants` list (`spec.md` §6.3). */
export type VariantRole =
  | 'current-src'
  | 'src'
  | 'srcset'
  | 'picture-source'
  | 'lazy-attr'
  | 'link-target'
  | 'standalone';

/**
 * Raw candidate entry extracted by Content Script inside a logical DOM group
 * (e.g. a `<picture>` + `<img>` + enclosing `<a href>`).
 */
export interface RawVariantCandidate {
  /** Source document for images collected from another album page. */
  sourcePageUrl?: string;
  /** Absolute URL normalized via `new URL(raw, baseURI).href` (or `large-data:<refId>` placeholder). */
  url: string;
  role: VariantRole;
  source: DetectionSource;
  /** Optional srcset descriptor such as `"1200w"` or `"2x"` (`spec.md` §6.1, §6.3). */
  descriptor?: string;
  /** Optional MIME type hint from `<source type="...">` or `data:` header. */
  mimeHint?: string;
  /** Natural pixel width if already loaded in page DOM (`img.naturalWidth`), else `null` (NEVER CSS width). */
  naturalWidth: number | null;
  /** Natural pixel height if already loaded in page DOM (`img.naturalHeight`), else `null` (NEVER CSS height). */
  naturalHeight: number | null;
  /** Set when `data:` URL exceeds `INLINE_DATA_URL_SESSION_MAX_CHARS` and full payload stays in Content Script. */
  largeDataRefId?: string;
}

/**
 * Logical candidate group emitted by Content Script for a single DOM occurrence.
 * Background merges groups sharing the same `primaryUrl` into one `ImageItem` (`spec.md` MVP-06).
 */
export interface RawCandidateGroup {
  /** Stable per-element key inside Content Script so rescans do not double-count `occurrenceCount`. */
  occurrenceKey: string;
  /** Default URL chosen by priority rules (`currentSrc` > `src` > lazy > first `srcset`). */
  primaryUrl: string;
  /** DOM traversal order index on first discovery (`spec.md` §4.3). */
  domOrder: number;
  /** All candidate URLs belonging to this DOM group (always includes `primaryUrl`). */
  variants: RawVariantCandidate[];
}

/**
 * Deduplicated URL variant attached to an `ImageItem` (`spec.md` MVP-04, §6.3).
 * Stores its own dimensions & format so switching variants preserves accurate metadata.
 */
export interface ImageVariant {
  sourcePageUrl?: string;
  url: string;
  roles: VariantRole[];
  /** Collected descriptors (e.g. `["800w", "2x"]`). Never labeled "Original" or "Highest Quality" (`spec.md` §6.3). */
  descriptors: string[];
  format: ImageFormat;
  naturalWidth: number | null;
  naturalHeight: number | null;
  largeDataRefId?: string;
}

/**
 * Canonical card entity managed per tab (`spec.md` §4.2, MVP-04, MVP-06, MVP-08).
 * Invariant: `itemId` is immutable for the life of the tab session; `primaryUrl` is the dedupe key.
 */
export interface ImageItem {
  /** Stable ID within the tab session (e.g. `"item_1"`), used in `selectedIds` and download tracking. */
  itemId: string;
  /** Deduplication key (`RawCandidateGroup.primaryUrl`). Query strings are preserved (`spec.md` §6.4). */
  primaryUrl: string;
  /** Currently active URL chosen for preview, copy, open, and download (defaults to `primaryUrl`). */
  selectedUrl: string;
  /** All selectable candidate URLs (`currentSrc`, `srcset` entries, enclosing `a.href` image target, etc.). */
  variants: ImageVariant[];
  /** Union of detection mechanisms where `primaryUrl` appeared on the page. */
  sources: DetectionSource[];
  /** Number of distinct DOM occurrences referencing `primaryUrl` (`spec.md` §4.2, MVP-06, AT-08). */
  occurrenceCount: number;
  /** First seen DOM order index; list order is ascending by `firstSeenOrder` (`spec.md` §4.3). */
  firstSeenOrder: number;
  /** Whether the user manually chose a variant from the card dropdown. */
  manualVariantSelected?: boolean;
}

/** Lifecycle status of a tab's scan session (`design.md` §3.2). */
export type ScanStatus =
  | 'unscanned'      // Extension icon has not been clicked on this tab yet (`activeTab` not granted)
  | 'scanning'       // Initial or manual rescan chunks currently running
  | 'watching'       // Initial scan finished; MutationObserver watching for manual-scroll additions
  | 'restricted'     // Browser-protected page (`chrome://`, Web Store, etc.) where scripts cannot run
  | 'stale'          // Tab navigated cross-origin; user must click toolbar icon to grant `activeTab` again
  | 'limit_reached'  // Reached `MAX_ITEMS_PER_TAB` safety cap
  | 'error';         // Unexpected injection/runtime error

/** Per-item download lifecycle states (`spec.md` §7.2). */
export type DownloadStatus =
  | 'idle'
  | 'queued'       // 待機中: Waiting in Background queue (`MAX_CONCURRENT_DOWNLOADS`)
  | 'starting'     // 開始処理中: Calling `chrome.downloads.download` (or resolving `blob:` URL)
  | 'in_progress'  // ダウンロード中: `downloadId` issued, Chrome actively downloading
  | 'completed'    // 成功: `state === 'complete'`
  | 'failed'       // 失敗: `state === 'interrupted'` (non-cancel) or pre-start failure
  | 'canceled';    // キャンセル: User canceled (`USER_CANCELED` / `USER_SHUTDOWN`)

/** Normalized failure categories for user-facing guidance and retry eligibility (`spec.md` §7.3, MVP-16). */
export type DownloadErrorCategory =
  | 'network_transient'  // Timeout / temporary disconnect -> manual retry recommended
  | 'not_found'          // 404 / expired URL -> warn URL may be invalid; never auto-retry
  | 'auth_or_forbidden'  // 401 / 403 / blocked -> warn login/permission may be needed; never bypass
  | 'blob_unreachable'   // Page `blob:` URL revoked or tab closed -> cannot retry unless rescanned
  | 'file_system'        // Disk full / path permission / security check failed
  | 'unknown';

/** Per-item download state tracked by Background Service Worker (`spec.md` §7.2, §7.3). */
export interface ItemDownloadState {
  panelId?: string;
  itemId: string;
  targetUrl: string;
  status: DownloadStatus;
  downloadId?: number;
  suggestedFilename?: string;
  /** Live received bytes while `in_progress` (ephemeral, populated for video downloads). */
  bytesReceived?: number;
  /** Total expected bytes if known from Content-Length or Blob size. */
  totalBytes?: number;
  /** Raw Chrome `InterruptReason` or internal error code. */
  errorCode?: string;
  errorCategory?: DownloadErrorCategory;
  /** Localized Japanese user-facing message explaining failure reason (`spec.md` §7.3). */
  errorMessage?: string;
  /** Whether the manual "再試行" action is meaningful for this failure (`spec.md` MVP-16). */
  retryable: boolean;
  updatedAt: number;
}

/** Active media tab mode inside Side Panel (`video_mode_design.md` §4.2, §6.1). */
export type MediaMode = 'image' | 'video';

/** Canonical video formats & manifest types supported for display and filtering. */
export type VideoFormat =
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'm4v'
  | 'ogg'
  | 'mkv'
  | 'avi'
  | 'hls'
  | 'dash'
  | 'unknown';

/** Delivery mechanism classification for video candidates (`video_mode_design.md` §4.1). */
export type VideoDeliveryType =
  | 'direct'          // Standard HTTP(S) / data: single-file video
  | 'blob_candidate'  // Page-origin `blob:` URL (verified & streamed only on explicit download click)
  | 'adaptive_hls'    // HLS `.m3u8` playlist
  | 'adaptive_dash'   // MPEG-DASH `.mpd` manifest
  | 'mse_stream'      // MediaSource virtual stream URL (cannot be saved standalone)
  | 'drm_protected'   // EME / Widevine protected media (blocked)
  | 'restricted_host';// Policy-restricted hostname such as YouTube (blocked)

/** Precondition gate state controlling whether a video variant can be selected and downloaded. */
export type DownloadReadiness = 'ready' | 'stream_manifest' | 'blocked';

/** Origin mechanism from which a video candidate was passively discovered. */
export type VideoDetectionSource =
  | 'video-element'
  | 'video-source'
  | 'shadow-video'
  | 'link-href'
  | 'lazy-video-attr'
  | 'meta-ogp'
  | 'json-ld'
  | 'script-embed'
  | 'network-resource'
  | 'network-header';

/** Role of a candidate URL inside a `VideoItem.variants` list. */
export type VideoVariantRole =
  | 'current-src'
  | 'src'
  | 'source-tag'
  | 'link-target'
  | 'lazy-attr'
  | 'manifest-variant'
  | 'metadata'
  | 'network';

/** Raw video candidate entry passively extracted by Content Script (zero network fetches). */
export interface RawVideoVariantCandidate {
  url: string;
  role: VideoVariantRole;
  source: VideoDetectionSource;
  descriptor?: string;
  mimeHint?: string;
  videoWidth: number | null;
  videoHeight: number | null;
  fileSizeBytes?: number | null;
  isDrmProtected?: boolean;
  isMseStream?: boolean;
  largeDataRefId?: string;
}

/** Logical video candidate group passively emitted by Content Script. */
export interface RawVideoCandidateGroup {
  occurrenceKey: string;
  primaryUrl: string;
  domOrder: number;
  durationSec: number | null;
  isLive?: boolean;
  posterUrl?: string;
  variants: RawVideoVariantCandidate[];
}

/** Deduplicated URL variant attached to a `VideoItem`. */
export interface VideoVariant {
  url: string;
  format: VideoFormat;
  deliveryType: VideoDeliveryType;
  readiness: DownloadReadiness;
  blockReason?: string;
  roles: VideoVariantRole[];
  descriptors: string[];
  videoWidth: number | null;
  videoHeight: number | null;
  fileSizeBytes: number | null;
  bitrateBps?: number | null;
  largeDataRefId?: string;
}

/** Canonical video card entity managed per tab (`itemId` uses `"vid_*"` namespace). */
export interface VideoItem {
  itemId: string;
  primaryUrl: string;
  selectedUrl: string;
  variants: VideoVariant[];
  sources: VideoDetectionSource[];
  durationSec: number | null;
  isLive?: boolean;
  posterUrl?: string;
  occurrenceCount: number;
  firstSeenOrder: number;
  manualVariantSelected?: boolean;
}

/** Resolution preset tiers for video filtering (orientation-agnostic via short/long side). */
export type VideoResolutionTier = 'all' | '4k' | '1080p' | '720p' | 'sd';

/** Duration preset ranges for video filtering. */
export type VideoDurationRange = 'all' | 'short' | 'medium' | 'long';

/** Sort criteria for displayed videos in Side Panel. */
export type VideoSortOrder =
  | 'position_asc'
  | 'position_desc'
  | 'resolution_desc'
  | 'resolution_asc'
  | 'duration_desc'
  | 'duration_asc'
  | 'filesize_desc'
  | 'filename_asc'
  | 'selected_first';

/** Side Panel filter criteria dedicated to Video Mode (`video_mode_design.md` §6.2). */
export interface VideoFilterState {
  urlQuery: string;
  minResolution: VideoResolutionTier;
  durationRange: VideoDurationRange;
  minDurationSec: number | null;
  formats: VideoFormat[];
  /** When true, hides `stream_manifest` and `blocked` items so only 1-click `ready` videos appear. */
  onlyReadyToDownload: boolean;
  /** Controls whether videos with unprobed (`null`) dimensions/duration remain visible when filtering. */
  includeUnknownMetadata: boolean;
}

/** Sort criteria for displayed images in Side Panel. */
export type SortOrder =
  | 'position_asc'   // ページ上の配置順 (上から下)
  | 'position_desc'  // ページ上の配置順 (下から上)
  | 'size_desc'       // 解像度 (大きい順)
  | 'size_asc'        // 解像度 (小さい順)
  | 'filename_asc'   // ファイル名 (A-Z / 連番昇順)
  | 'filename_desc'  // ファイル名 (Z-A / 連番降順)
  | 'selected_first'; // 選択中を先頭

/** Thumbnail display size mode in Side Panel. */
export type CardSize = 'auto' | 'small' | 'medium' | 'large';

/** Side Panel filter criteria (`spec.md` §4.1, MVP-11, MVP-12, MVP-13). */
export interface FilterState {
  /** Case-insensitive substring query matched against `item.selectedUrl` (`spec.md` MVP-13). */
  urlQuery: string;
  /** Minimum natural width in px (`null` or `0` = no minimum). */
  minWidth: number | null;
  /** Minimum natural height in px (`null` or `0` = no minimum). */
  minHeight: number | null;
  /** Selected formats (`empty array` = all formats shown; `'unknown'` is selectable per MVP-12). */
  formats: ImageFormat[];
  /**
   * When `minWidth` or `minHeight` is active, controls whether items with unknown (`null`) dimensions
   * remain visible (`spec.md` MVP-11). UI must always show count of excluded unknown-dimension items.
   */
  includeUnknownDimensions: boolean;
}

/** Aggregated download counters for the footer status bar (`spec.md` §4.1, §7.3). */
export interface DownloadSummaryCounts {
  queued: number;
  active: number; // `starting` + `in_progress`
  completed: number;
  failed: number;
  canceled: number;
}

/**
 * Complete snapshot of a single tab's isolated state (`spec.md` MVP-19, AT-18, AT-19).
 * Keyed strictly by `tabId`.
 */
export interface TabSessionSnapshot {
  tabId: number;
  /** Monotonically increasing sequence number per tab, used by Side Panel to detect missed delta events. */
  revision: number;
  /** Page URL at the time `activeTab` was granted (undefined when `scanStatus === 'unscanned'`). */
  pageUrl?: string;
  /** Hostname displayed in Side Panel header (`spec.md` §4.1, §4.3). */
  domain?: string;
  /** Original page title for display. Folder naming separately removes corroborated page decorations. */
  pageTitle?: string;
  /** Epoch ID incremented when the tab navigates to a new document so stale content batches are dropped. */
  scanEpoch: number;
  scanStatus: ScanStatus;
  statusMessage?: string;
  /** Ordered list of deduplicated image items (`firstSeenOrder` ascending). */
  items: ImageItem[];
  /** Ordered list of deduplicated video items (`firstSeenOrder` ascending). */
  videos: VideoItem[];
  /** Selected image `itemId`s. Preserved even when items are hidden by filters (`spec.md` §4.3, MVP-09, AT-12). */
  selectedIds: string[];
  /** Selected video `itemId`s (`"vid_*"`), isolated from image selections. */
  selectedVideoIds: string[];
  /** Per-item download state keyed by `itemId` (shared across `"item_*"` and `"vid_*"`). */
  downloads: Record<string, ItemDownloadState>;
}

/** Minimal crash-proof record persisted under `STORAGE_KEYS.ACTIVE_DOWNLOAD_INDEX`. */
export interface ActiveDownloadIndexEntry {
  downloadId: number;
  tabId: number;
  itemId: string;
  targetUrl: string;
  startedAt: number;
  /** Optional object URL in Side Panel / extension scope to revoke once download finishes. */
  revokeObjectUrl?: string;
  /** Keep scoped headers until direct HTTP download completion. */
  refererRuleKey?: string;
}

/**
 * Global architectural constants & safety guardrails.
 * See `design.md` for rationale behind each threshold.
 */

/** Path of the compiled IIFE content script inside `dist/`, used by `chrome.scripting.executeScript`. */
export const CONTENT_SCANNER_SCRIPT_PATH = 'content/scanner.js';

/** Default concurrent Chrome Downloads API invocations for images (`spec.md` §7.2). */
export const MAX_CONCURRENT_DOWNLOADS = 3;

/** Concurrent download slots dedicated to the video lane (`video_mode_design.md` §5.1). */
export const MAX_CONCURRENT_VIDEO_DOWNLOADS = 2;

/** Hard cap on unique deduplicated `ImageItem` records retained per tab (`spec.md` §2 load control). */
export const MAX_ITEMS_PER_TAB = 2_000;

/** Hard cap on unique deduplicated `VideoItem` records retained per tab. */
export const MAX_VIDEOS_PER_TAB = 500;

/** Maximum synchronous time slice (ms) per DOM walk chunk before yielding main thread (`spec.md` §6.5, §9). */
export const SCAN_CHUNK_BUDGET_MS = 8;

/** Maximum candidate groups buffered before flushing a batch message to Background (`spec.md` §6.5). */
export const SCAN_BATCH_MAX_SIZE = 40;

/** Maximum buffer delay (ms) before flushing a partial scan batch to Background (`spec.md` §6.5). */
export const SCAN_BATCH_INTERVAL_MS = 50;

/** Debounce/throttle interval (ms) for MutationObserver incremental scans (`spec.md` §6.5). */
export const MUTATION_DEBOUNCE_MS = 150;

/** Fixed coalescing window; sustained changes cannot starve persistence and idle work never repeats. */
export const SESSION_PERSIST_DEBOUNCE_MS = 750;

/** Cache budgets exclude active downloads; no periodic eviction/cleanup timer is needed. */
export const MAX_CACHED_TAB_SESSIONS = 8;
export const SESSION_CACHE_BUDGET_BYTES = 6 * 1024 * 1024;
export const MAX_SESSION_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_VARIANTS_PER_ITEM = 32;
export const MAX_OCCURRENCE_KEYS_PER_TAB = 20_000;
export const LARGE_DATA_CACHE_MAX_BYTES = 16 * 1024 * 1024;
export const MAX_PENDING_SCAN_NODES = 4_000;
export const BUFFERED_VIDEO_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Maximum character length of a `data:` URL stored inline inside `chrome.storage.session`.
 * Larger `data:` URLs MUST be kept in Content Script memory (`largeDataRefId`) so `storage.session`
 * never hits Chrome's hard 10 MB `QUOTA_BYTES` limit (`design.md` §7.2).
 */
export const INLINE_DATA_URL_SESSION_MAX_CHARS = 32_768;

/** Maximum byte size allowed when reading a page-origin image `blob:` URL inline as Data URL. */
export const BLOB_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Explicitly started scan tools never persist or run on ordinary scans. */
export const SCAN_TOOL_MAX_DURATION_MS = 120_000;
/** Sweep quickly through every viewport; allow asynchronous additions to settle only at the bottom. */
export const AUTO_SCROLL_STEP_INTERVAL_MS = 50;
export const AUTO_SCROLL_VIEWPORT_FRACTION = 0.95;
export const AUTO_SCROLL_BOTTOM_WAIT_MS = 800;
export const AUTO_SCROLL_BOTTOM_STABLE_CHECKS = 3;
export const AUTO_SCROLL_MAX_STEPS = 200;
export const IMAGE_PROBE_CONCURRENCY = 3;
export const IMAGE_PROBE_TIMEOUT_MS = 8_000;
export const PAGE_COLLECTION_MAX_PAGES = 50;
export const PAGE_COLLECTION_HTML_MAX_CHARS = 2_000_000;

/** Threshold up to which a video `blob:` URL is returned inline as Data URL; larger blobs stream via Port Chunk Bridge. */
export const INLINE_VIDEO_BLOB_MAX_BYTES = 16 * 1024 * 1024;

/** Maximum byte size allowed when streaming a page-origin video `blob:` URL on-demand (1 GB). */
export const VIDEO_BLOB_MAX_BYTES = 1024 * 1024 * 1024;

/** Chunk byte size (4 MB) when streaming large blobs over extension Port (stays well below 64 MB IPC cap). */
export const BLOB_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

/** Maximum sanitized filename stem length (excluding dot + extension) (`spec.md` §7.1). */
export const MAX_FILENAME_STEM_LENGTH = 100;

/** Maximum sanitized folder name length to avoid Windows MAX_PATH (260 chars) overflows (`spec.md` §7.1). */
export const MAX_FOLDER_NAME_LENGTH = 80;

/** Allowed URL protocols for candidate extraction (`spec.md` §6.4, §9). Never allow `javascript:` etc. */
export const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:']);

/**
 * Explicit allowlist of lazy-loading and high-resolution single-URL attributes (`spec.md` MVP-03, §6.1).
 * Supports lazy loaders and popular lightbox / gallery zoom attributes (e.g. ElevateZoom, Lightgallery, PhotoSwipe, WordPress).
 */
export const LAZY_SRC_ATTR_ALLOWLIST = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-lazy',
  'data-url',
  'data-hi-res-src',
  'data-defer-src',
  'data-highres',
  'data-hi-res',
  'data-zoom-image',
  'data-large',
  'data-large-img',
  'data-full',
  'data-full-img',
  'data-full-image',
  'data-orig-file',
  'data-original-image',
] as const;

/** High-resolution image attributes on <img> or <a> */
export const HIGH_RES_ATTR_NAMES = new Set([
  'data-highres',
  'data-hi-res',
  'data-hi-res-src',
  'data-zoom-image',
  'data-large',
  'data-large-img',
  'data-full',
  'data-full-img',
  'data-full-image',
  'data-orig-file',
  'data-original-image',
]);

/**
 * Explicit allowlist of lazy-loading srcset attributes (`spec.md` MVP-03, §6.1).
 */
export const LAZY_SRCSET_ATTR_ALLOWLIST = [
  'data-srcset',
  'data-lazy-srcset',
] as const;

/**
 * Explicit allowlist of lazy-loading video source attributes (`video_mode_design.md` §3.1).
 */
export const LAZY_VIDEO_SRC_ATTR_ALLOWLIST = [
  'data-video-src',
  'data-video',
  'data-video-url',
  'data-mp4',
  'data-webm',
  'data-stream',
  'data-hls',
] as const;

/**
 * Attribute filter passed to `MutationObserver.observe` so hover animations (`class` toggles)
 * do not flood the main thread (`design.md` §6).
 */
export const OBSERVED_MUTATION_ATTRIBUTES: readonly string[] = [
  'src',
  'srcset',
  'poster',
  'href',
  'xlink:href',
  'style',
  'data-fancybox-type',
  'data-type',
  'data-lightbox',
  'data-fancybox',
  'rel',
  ...LAZY_SRC_ATTR_ALLOWLIST,
  ...LAZY_SRCSET_ATTR_ALLOWLIST,
  ...LAZY_VIDEO_SRC_ATTR_ALLOWLIST,
];

/**
 * File extensions recognized when judging whether an enclosing `<a href="...">` points to an image file
 * (`spec.md` MVP-04, §6.1, §6.3). Checked strictly against `URL.pathname` (case-insensitive).
 */
export const LIKELY_IMAGE_PATH_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
]);

/**
 * File extensions recognized as video files or streaming manifests (`video_mode_design.md` §3, §4).
 */
export const LIKELY_VIDEO_PATH_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.ogv',
  '.ogg',
  '.mkv',
  '.avi',
  '.m3u8',
  '.mpd',
]);

/**
 * Hostnames where video downloading is disabled to strictly comply with Chrome Web Store policies.
 */
export const RESTRICTED_VIDEO_DOMAINS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'www.youtube-nocookie.com',
]);

/** Port channel names used for long-lived connections and large blob streaming. */
export const PORT_NAMES = {
  SCAN_TOOLS: 'hoihoi-scan-tools',
  SIDEPANEL_LIFECYCLE: 'hoihoi-sidepanel',
  SCANNER_LIFECYCLE: 'hoihoi-scanner-watch',
  BLOB_STREAM: 'hoihoi-blob-stream',
} as const;

/** Storage key namespaces inside `chrome.storage.session` (`design.md` §7.2). */
export const STORAGE_KEYS = {
  /** Critical mapping `downloadId -> { tabId, itemId }` kept separate so quota errors never break active downloads. */
  ACTIVE_DOWNLOAD_INDEX: 'wic:active_downloads_v1',
  /** Prefix for per-tab session state: `wic:tab_session_v1:<tabId>`. */
  TAB_SESSION_PREFIX: 'wic:tab_session_v1:',
} as const;

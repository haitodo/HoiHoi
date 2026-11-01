/**
 * Global architectural constants & safety guardrails.
 * See `design.md` for rationale behind each threshold.
 */

/** Path of the compiled IIFE content script inside `dist/`, used by `chrome.scripting.executeScript`. */
export const CONTENT_SCANNER_SCRIPT_PATH = 'content/scanner.js';

/** Default concurrent Chrome Downloads API invocations (`spec.md` §7.2). */
export const MAX_CONCURRENT_DOWNLOADS = 3;

/** Hard cap on unique deduplicated `ImageItem` records retained per tab (`spec.md` §2 load control). */
export const MAX_ITEMS_PER_TAB = 2_000;

/** Maximum synchronous time slice (ms) per DOM walk chunk before yielding main thread (`spec.md` §6.5, §9). */
export const SCAN_CHUNK_BUDGET_MS = 8;

/** Maximum candidate groups buffered before flushing a batch message to Background (`spec.md` §6.5). */
export const SCAN_BATCH_MAX_SIZE = 40;

/** Maximum buffer delay (ms) before flushing a partial scan batch to Background (`spec.md` §6.5). */
export const SCAN_BATCH_INTERVAL_MS = 50;

/** Debounce/throttle interval (ms) for MutationObserver incremental scans (`spec.md` §6.5). */
export const MUTATION_DEBOUNCE_MS = 150;

/** Debounce interval (ms) for coalescing non-critical `chrome.storage.session` writes in Background SW. */
export const SESSION_PERSIST_DEBOUNCE_MS = 100;

/**
 * Maximum character length of a `data:` URL stored inline inside `chrome.storage.session`.
 * Larger `data:` URLs MUST be kept in Content Script memory (`largeDataRefId`) so `storage.session`
 * never hits Chrome's hard 10 MB `QUOTA_BYTES` limit (`design.md` §7.2).
 */
export const INLINE_DATA_URL_SESSION_MAX_CHARS = 32_768;

/** Maximum byte size allowed when reading a page-origin `blob:` URL on-demand for download. */
export const BLOB_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

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
 * Attribute filter passed to `MutationObserver.observe` so hover animations (`class` toggles)
 * do not flood the main thread (`design.md` §6).
 */
export const OBSERVED_MUTATION_ATTRIBUTES: readonly string[] = [
  'src',
  'srcset',
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

/** Storage key namespaces inside `chrome.storage.session` (`design.md` §7.2). */
export const STORAGE_KEYS = {
  /** Critical mapping `downloadId -> { tabId, itemId }` kept separate so quota errors never break active downloads. */
  ACTIVE_DOWNLOAD_INDEX: 'wic:active_downloads_v1',
  /** Prefix for per-tab session state: `wic:tab_session_v1:<tabId>`. */
  TAB_SESSION_PREFIX: 'wic:tab_session_v1:',
} as const;

import { MAX_FILENAME_STEM_LENGTH, MAX_FOLDER_NAME_LENGTH } from './constants';
import type { ImageFormat, VideoFormat } from './types';
import { inferImageFormat } from './url-utils';
import { inferVideoFormat } from './video-utils';
import { normalizePageTitleForFolder } from './page-title-utils';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;

// Disallowed characters in Windows/POSIX file paths: \ / : * ? " < > | and control characters
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f\x7f]/g;

const FORMAT_TO_EXTENSION: Record<ImageFormat, string> = {
  jpeg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  svg: '.svg',
  avif: '.avif',
  bmp: '.bmp',
  ico: '.ico',
  unknown: '',
};

/**
 * Builds a safe, cross-platform folder name for saving downloaded images.
 *
 * Rules:
 * 1. Sanitizes forbidden filesystem characters (\ / : * ? " < > | and control chars) into '_'.
 * 2. Normalizes multiple spaces, tabs, and newlines.
 * 3. Strips leading and trailing dots, spaces, underscores, and full-width spaces.
 * 4. Falls back to sanitized domain or 'images' if title is empty or becomes empty.
 * 5. Handles Windows reserved device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9).
 * 6. Truncates length to `MAX_FOLDER_NAME_LENGTH` (80 chars) to prevent Windows MAX_PATH overflows.
 */
export function buildSafeFolderName(title?: string, domain?: string): string {
  let raw = (title ?? '').trim();

  // 1. Replace newlines, tabs, and control characters with a space
  raw = raw.replace(/[\r\n\t\f\v]+/g, ' ');

  // 2. Replace illegal filesystem characters with '_'
  raw = raw.replace(ILLEGAL_FILENAME_CHARS, '_');

  // 3. Clean up mixed spaces and underscores to produce readable folder names
  raw = raw.replace(/\s*_\s*/g, '_');
  raw = raw.replace(/_+/g, '_');
  raw = raw.replace(/\s+/g, ' ');

  // 4. Strip leading and trailing periods, spaces, full-width spaces, and underscores
  raw = raw.replace(/^[.\s\u3000_]+|[.\s\u3000_]+$/g, '');

  // 5. Fallback if empty
  if (!raw) {
    if (domain) {
      const cleanDomain = domain
        .replace(ILLEGAL_FILENAME_CHARS, '_')
        .replace(/^[.\s\u3000_]+|[.\s\u3000_]+$/g, '');
      if (cleanDomain) {
        raw = cleanDomain;
      }
    }
    if (!raw) {
      raw = 'images';
    }
  }

  // 6. Handle Windows reserved device names
  if (WINDOWS_RESERVED_NAMES.test(raw)) {
    raw = `_${raw}`;
  }

  // 7. Truncate length
  if (raw.length > MAX_FOLDER_NAME_LENGTH) {
    raw = raw.slice(0, MAX_FOLDER_NAME_LENGTH);
    // Re-trim trailing dots/spaces/underscores created by truncation
    raw = raw.replace(/[.\s\u3000_]+$/g, '');
    if (!raw) {
      raw = 'images';
    }
    if (WINDOWS_RESERVED_NAMES.test(raw)) {
      raw = `_${raw}`;
    }
  }

  return raw;
}

/**
 * Builds a safe, cross-platform filename for downloading (`spec.md` §7.1, AT-17).
 *
 * Rules:
 * 1. Derives stem from decoded URL pathname basename where possible.
 * 2. Falls back to `<domain>_<index>` when URL is `data:`, `blob:`, or has no usable basename.
 * 3. Sanitizes forbidden filesystem characters and Windows reserved names (CON, NUL, PRN, etc.).
 * 4. Truncates excessively long stems to `MAX_FILENAME_STEM_LENGTH` (100 chars).
 * 5. Appends extension based on inferred format if missing or mismatched.
 * 6. If `folderName` or `pageTitle` is provided, prepends a safe subdirectory.
 *    Automatic titles omit page decorations corroborated by `pageUrl`; explicit folder names are preserved.
 */
export function buildSafeDownloadFilename(options: {
  targetUrl: string;
  domain?: string;
  pageTitle?: string;
  pageUrl?: string;
  folderName?: string;
  itemIndex?: number;
  format?: ImageFormat;
}): string {
  const { targetUrl, domain, pageTitle, pageUrl, folderName, itemIndex = 1, format } = options;
  const inferredFormat = format ?? inferImageFormat(targetUrl);
  const extFromFormat = FORMAT_TO_EXTENSION[inferredFormat];

  let rawStem = '';
  let rawExt = '';

  if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
    try {
      const parsed = new URL(targetUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1];

      if (lastSegment) {
        let decoded = lastSegment;
        try {
          decoded = decodeURIComponent(lastSegment);
        } catch {
          // Keep raw segment if decodeURIComponent throws URIError
        }

        const lastDot = decoded.lastIndexOf('.');
        if (lastDot > 0 && lastDot < decoded.length - 1) {
          rawStem = decoded.slice(0, lastDot);
          rawExt = decoded.slice(lastDot).toLowerCase();
        } else {
          rawStem = decoded;
        }
      }
    } catch {
      // Fallback
    }
  }

  // Fallback to domain + padded index if no valid stem from URL path
  if (!rawStem || rawStem.trim() === '') {
    const cleanDomain = (domain ?? 'image').replace(ILLEGAL_FILENAME_CHARS, '_');
    const padded = String(itemIndex).padStart(4, '0');
    rawStem = `${cleanDomain}_${padded}`;
  }

  // Sanitize stem
  let cleanStem = rawStem.replace(ILLEGAL_FILENAME_CHARS, '_').trim();

  // Strip leading and trailing periods/spaces (Windows Explorer issue)
  cleanStem = cleanStem.replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleanStem) {
    cleanStem = `image_${String(itemIndex).padStart(4, '0')}`;
  }

  // Handle Windows reserved device names (e.g. "con", "prn.jpg")
  if (WINDOWS_RESERVED_NAMES.test(cleanStem)) {
    cleanStem = `_${cleanStem}`;
  }

  // Truncate length
  if (cleanStem.length > MAX_FILENAME_STEM_LENGTH) {
    cleanStem = cleanStem.slice(0, MAX_FILENAME_STEM_LENGTH);
  }

  // Determine final extension
  let finalExt = rawExt;
  // If no extension or rawExt is not typical of the inferred format, use standard extension
  if (!finalExt || (extFromFormat && !isValidExtensionForFormat(finalExt, inferredFormat))) {
    finalExt = extFromFormat;
  }

  const safeFilename = `${cleanStem}${finalExt}`;

  // If folderName or pageTitle is provided, prepend safe subdirectory
  const folderCandidate = folderName !== undefined ? folderName
    : pageTitle === undefined ? undefined : normalizePageTitleForFolder(pageTitle, pageUrl);
  if (folderCandidate !== undefined) {
    const safeFolder = buildSafeFolderName(folderCandidate, domain);
    return `${safeFolder}/${safeFilename}`;
  }

  return safeFilename;
}

function isValidExtensionForFormat(ext: string, format: ImageFormat): boolean {
  switch (format) {
    case 'jpeg':
      return ext === '.jpg' || ext === '.jpeg';
    case 'png':
      return ext === '.png';
    case 'gif':
      return ext === '.gif';
    case 'webp':
      return ext === '.webp';
    case 'svg':
      return ext === '.svg';
    case 'avif':
      return ext === '.avif';
    case 'bmp':
      return ext === '.bmp';
    case 'ico':
      return ext === '.ico';
    case 'unknown':
      return true;
  }
}

/**
 * Extracts a comparable filename stem or basename from a URL for sorting purposes.
 * Supports http(s), data URLs, blob URLs, and percent-encoded paths.
 */
export function extractFilenameForSort(targetUrl: string): string {
  if (!targetUrl) return '';
  if (targetUrl.startsWith('http:') || targetUrl.startsWith('https:')) {
    try {
      const parsed = new URL(targetUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (lastSegment) {
        try {
          return decodeURIComponent(lastSegment);
        } catch {
          return lastSegment;
        }
      }
    } catch {}
  }
  return targetUrl;
}

const VIDEO_FORMAT_TO_EXTENSION: Record<VideoFormat, string> = {
  mp4: '.mp4',
  webm: '.webm',
  mov: '.mov',
  m4v: '.m4v',
  ogg: '.ogv',
  mkv: '.mkv',
  avi: '.avi',
  hls: '.m3u8',
  dash: '.mpd',
  unknown: '.mp4',
};

/**
 * Extracts a filename from an HTTP `Content-Disposition` header if present.
 * Supports RFC 5987 `filename*=UTF-8''...` as well as quoted/unquoted `filename=...`.
 */
export function extractFilenameFromContentDisposition(header?: string | null): string | undefined {
  if (!header) return undefined;

  // 1. RFC 5987 `filename*=`
  const starMatch = /filename\*\s*=\s*(?:[a-zA-Z0-9_-]+'[a-zA-Z0-9_-]*')?([^;\r\n]+)/i.exec(header);
  if (starMatch?.[1]) {
    const raw = starMatch[1].trim().replace(/^"(.*)"$/, '$1');
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // Keep raw if malformed percent-encoding
    }
    const base = decoded.split(/[\\/]/).pop()?.trim();
    if (base) return base;
  }

  // 2. Quoted `filename="..."`
  const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quotedMatch?.[1]) {
    const base = quotedMatch[1].trim().split(/[\\/]/).pop()?.trim();
    if (base) return base;
  }

  // 3. Unquoted `filename=...`
  const plainMatch = /filename\s*=\s*([^;\s\r\n"]+)/i.exec(header);
  if (plainMatch?.[1]) {
    const base = plainMatch[1].trim().split(/[\\/]/).pop()?.trim();
    if (base) return base;
  }

  return undefined;
}

function splitFilenameStemAndExt(filename: string): { stem: string; ext: string } {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0 && lastDot < filename.length - 1) {
    return {
      stem: filename.slice(0, lastDot),
      ext: filename.slice(lastDot).toLowerCase(),
    };
  }
  return { stem: filename, ext: '' };
}

function extractStemAndExtFromHttpUrl(urlStr?: string): { stem: string; ext: string } | null {
  if (!urlStr || (!urlStr.startsWith('http:') && !urlStr.startsWith('https:'))) {
    return null;
  }
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (!lastSegment) return null;

    let decoded = lastSegment;
    try {
      decoded = decodeURIComponent(lastSegment);
    } catch {
      // Keep raw segment if decodeURIComponent throws
    }
    return splitFilenameStemAndExt(decoded);
  } catch {
    return null;
  }
}

/**
 * Builds a safe, cross-platform filename for downloading video files (`video_mode_design.md` §5).
 */
export function buildSafeVideoDownloadFilename(options: {
  targetUrl: string;
  resolvedUrl?: string;
  contentDisposition?: string;
  domain?: string;
  pageTitle?: string;
  pageUrl?: string;
  folderName?: string;
  itemIndex?: number;
  format?: VideoFormat;
  mimeHint?: string;
  overrideExtension?: string;
}): string {
  const {
    targetUrl,
    resolvedUrl,
    contentDisposition,
    domain,
    pageTitle,
    pageUrl,
    folderName,
    itemIndex = 1,
    format,
    mimeHint,
    overrideExtension,
  } = options;
  const resolvedFormat = resolvedUrl ? inferVideoFormat(resolvedUrl, mimeHint) : 'unknown';
  const inferredFormat =
    format && format !== 'unknown'
      ? format
      : resolvedFormat !== 'unknown'
        ? resolvedFormat
        : inferVideoFormat(targetUrl, mimeHint);
  const extFromFormat = VIDEO_FORMAT_TO_EXTENSION[inferredFormat];

  let rawStem = '';
  let rawExt = '';

  const cdFilename = extractFilenameFromContentDisposition(contentDisposition);
  if (cdFilename) {
    const split = splitFilenameStemAndExt(cdFilename);
    rawStem = split.stem;
    rawExt = split.ext;
  } else {
    const fromResolved = extractStemAndExtFromHttpUrl(resolvedUrl);
    const fromTarget = extractStemAndExtFromHttpUrl(targetUrl);

    const resolvedHasVideoExt = Boolean(
      fromResolved?.ext && isValidExtensionForVideoFormat(fromResolved.ext, 'unknown'),
    );
    const targetHasVideoExt = Boolean(
      fromTarget?.ext && isValidExtensionForVideoFormat(fromTarget.ext, 'unknown'),
    );

    const chosen = resolvedHasVideoExt
      ? fromResolved
      : targetHasVideoExt
        ? fromTarget
        : fromResolved?.stem
          ? fromResolved
          : fromTarget;

    if (chosen) {
      rawStem = chosen.stem;
      rawExt = chosen.ext;
    }
  }

  if (!rawStem || rawStem.trim() === '') {
    const cleanDomain = (domain ?? 'video').replace(ILLEGAL_FILENAME_CHARS, '_');
    const padded = String(itemIndex).padStart(4, '0');
    rawStem = `${cleanDomain}_${padded}`;
  }

  let cleanStem = rawStem.replace(ILLEGAL_FILENAME_CHARS, '_').trim();
  cleanStem = cleanStem.replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleanStem) {
    cleanStem = `video_${String(itemIndex).padStart(4, '0')}`;
  }

  if (WINDOWS_RESERVED_NAMES.test(cleanStem)) {
    cleanStem = `_${cleanStem}`;
  }

  if (cleanStem.length > MAX_FILENAME_STEM_LENGTH) {
    cleanStem = cleanStem.slice(0, MAX_FILENAME_STEM_LENGTH);
  }

  let finalExt = overrideExtension ?? rawExt;
  if (!overrideExtension && (!finalExt || !isValidExtensionForVideoFormat(finalExt, inferredFormat))) {
    finalExt = extFromFormat;
  }

  const safeFilename = `${cleanStem}${finalExt}`;
  const folderCandidate = folderName !== undefined ? folderName
    : pageTitle === undefined ? undefined : normalizePageTitleForFolder(pageTitle, pageUrl);
  if (folderCandidate !== undefined) {
    const safeFolder = buildSafeFolderName(folderCandidate, domain);
    return `${safeFolder}/${safeFilename}`;
  }

  return safeFilename;
}

function isValidExtensionForVideoFormat(ext: string, format: VideoFormat): boolean {
  switch (format) {
    case 'mp4':
      return ext === '.mp4';
    case 'webm':
      return ext === '.webm';
    case 'mov':
      return ext === '.mov' || ext === '.qt';
    case 'm4v':
      return ext === '.m4v';
    case 'ogg':
      return ext === '.ogv' || ext === '.ogg';
    case 'mkv':
      return ext === '.mkv';
    case 'avi':
      return ext === '.avi';
    case 'hls':
      return ext === '.m3u8';
    case 'dash':
      return ext === '.mpd';
    case 'unknown':
      return /^\.(mp4|webm|mov|m4v|ogv|ogg|mkv|avi)$/i.test(ext);
  }
}


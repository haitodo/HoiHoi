import { MAX_FILENAME_STEM_LENGTH, MAX_FOLDER_NAME_LENGTH } from './constants';
import type { ImageFormat } from './types';
import { inferImageFormat } from './url-utils';

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
 */
export function buildSafeDownloadFilename(options: {
  targetUrl: string;
  domain?: string;
  pageTitle?: string;
  folderName?: string;
  itemIndex?: number;
  format?: ImageFormat;
}): string {
  const { targetUrl, domain, pageTitle, folderName, itemIndex = 1, format } = options;
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
  const folderCandidate = folderName !== undefined ? folderName : pageTitle;
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

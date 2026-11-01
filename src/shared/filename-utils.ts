import { MAX_FILENAME_STEM_LENGTH } from './constants';
import type { ImageFormat } from './types';
import { inferImageFormat } from './url-utils';

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

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
 * Builds a safe, cross-platform filename for downloading (`spec.md` §7.1, AT-17).
 *
 * Rules:
 * 1. Derives stem from decoded URL pathname basename where possible.
 * 2. Falls back to `<domain>_<index>` when URL is `data:`, `blob:`, or has no usable basename.
 * 3. Sanitizes forbidden filesystem characters and Windows reserved names (CON, NUL, PRN, etc.).
 * 4. Truncates excessively long stems to `MAX_FILENAME_STEM_LENGTH` (100 chars).
 * 5. Appends extension based on inferred format if missing or mismatched.
 */
export function buildSafeDownloadFilename(options: {
  targetUrl: string;
  domain?: string;
  itemIndex?: number;
  format?: ImageFormat;
}): string {
  const { targetUrl, domain, itemIndex = 1, format } = options;
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

  return `${cleanStem}${finalExt}`;
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

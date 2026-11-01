import {
  ALLOWED_IMAGE_PROTOCOLS,
  LIKELY_IMAGE_PATH_EXTENSIONS,
} from './constants';
import type { ImageFormat } from './types';

/**
 * Resolves a raw URL against a base URI and validates its scheme against allowed protocols.
 * Never allows `javascript:`, `vbscript:`, etc.
 */
export function resolveAndValidateImageUrl(
  rawUrl: string,
  baseUri: string,
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const resolved = new URL(trimmed, baseUri);
    if (!ALLOWED_IMAGE_PROTOCOLS.has(resolved.protocol)) {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Parses an HTML `srcset` attribute safely according to the HTML specification.
 *
 * CRITICAL NOTE: Image URLs often contain commas (e.g. Cloudinary / image CDN transforms
 * like `/image/upload/w_400,c_scale/pic.jpg 400w`). A naive `str.split(',')` breaks these URLs.
 * This parser parses descriptor and comma boundaries correctly.
 */
export function parseSrcset(
  srcsetString: string,
  baseUri: string,
): Array<{ url: string; descriptor?: string }> {
  const input = srcsetString.trim();
  if (!input) return [];

  const candidates: Array<{ url: string; descriptor?: string }> = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    // 1. Skip leading whitespace and separating commas
    while (pos < len && (/\s/.test(input[pos]!) || input[pos] === ',')) {
      pos++;
    }
    if (pos >= len) break;

    // 2. Read URL token: scan until whitespace
    const urlStart = pos;
    while (pos < len && !/\s/.test(input[pos]!)) {
      pos++;
    }
    let rawUrl = input.slice(urlStart, pos);

    // If the token ends with a comma and there is no descriptor following,
    // the trailing comma is a candidate separator, not part of the URL.
    let hadTrailingComma = false;
    if (rawUrl.endsWith(',')) {
      rawUrl = rawUrl.slice(0, -1);
      hadTrailingComma = true;
    }

    // Skip whitespace between URL and optional descriptor
    while (pos < len && /\s/.test(input[pos]!)) {
      pos++;
    }

    // 3. Read optional descriptor if we didn't already hit a terminating comma
    let descriptor: string | undefined;
    if (!hadTrailingComma && pos < len && input[pos] !== ',') {
      const descStart = pos;
      while (pos < len && input[pos] !== ',') {
        pos++;
      }
      descriptor = input.slice(descStart, pos).trim();
    }

    if (rawUrl) {
      const validUrl = resolveAndValidateImageUrl(rawUrl, baseUri);
      if (validUrl) {
        candidates.push({
          url: validUrl,
          descriptor: descriptor || undefined,
        });
      }
    }

    // Consume trailing comma if present
    if (pos < len && input[pos] === ',') {
      pos++;
    }
  }

  return candidates;
}

/**
 * Extracts all valid image URLs declared inside a computed CSS `background-image` value.
 * Handles multiple comma-separated backgrounds and gradients (e.g. `url("a.png"), linear-gradient(...), url('b.png')`).
 */
export function extractCssBackgroundUrls(
  bgStyleValue: string,
  baseUri: string,
): string[] {
  if (!bgStyleValue || bgStyleValue === 'none') return [];

  // Match url(...) taking into account optional single or double quotes
  const urlRegex = /url\(\s*(?:['"]([^'"]+)['"]|([^'")]+))\s*\)/gi;
  const urls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(bgStyleValue)) !== null) {
    const raw = match[1] ?? match[2];
    if (raw) {
      const validUrl = resolveAndValidateImageUrl(raw, baseUri);
      if (validUrl && !urls.includes(validUrl)) {
        urls.push(validUrl);
      }
    }
  }

  return urls;
}

/**
 * Determines whether an enclosing `<a href="...">` target is likely an image file.
 * Checks `URL.pathname` case-insensitively against known extensions (`spec.md` MVP-04, §6.1).
 */
export function isLikelyImageLinkHref(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    // Check standard extension at end or before CDN preset modifiers like !sml, !lrg, !preview
    const cleanPath = path.split('!')[0] ?? path;
    for (const ext of LIKELY_IMAGE_PATH_EXTENSIONS) {
      if (cleanPath.endsWith(ext)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Infers canonical `ImageFormat` without initiating secondary HTTP requests (`spec.md` §5, MVP-08, MVP-12).
 * Priority:
 * 1. `data:` MIME header
 * 2. `mimeHint` (<source type="...">)
 * 3. File extension in URL pathname (supports !preset suffixes like .jpeg!sml)
 * 4. Common format query parameters (`?format=webp`, `?fm=jpg`, etc.)
 */
export function inferImageFormat(
  urlStr: string,
  mimeHint?: string,
): ImageFormat {
  if (urlStr.startsWith('data:')) {
    const mimeMatch = /^data:image\/([a-zA-Z0-9+.-]+);/i.exec(urlStr);
    if (mimeMatch?.[1]) {
      return normalizeMimeSubtype(mimeMatch[1]);
    }
  }

  if (mimeHint && mimeHint.startsWith('image/')) {
    const subtype = mimeHint.slice('image/'.length).trim().toLowerCase();
    const mapped = normalizeMimeSubtype(subtype);
    if (mapped !== 'unknown') return mapped;
  }

  try {
    const parsed = new URL(urlStr);
    const path = (parsed.pathname.split('!')[0] ?? parsed.pathname).toLowerCase();

    if (/\.(jpe?g)$/.test(path)) return 'jpeg';
    if (/\.png$/.test(path)) return 'png';
    if (/\.gif$/.test(path)) return 'gif';
    if (/\.webp$/.test(path)) return 'webp';
    if (/\.svg$/.test(path)) return 'svg';
    if (/\.avif$/.test(path)) return 'avif';
    if (/\.bmp$/.test(path)) return 'bmp';
    if (/\.ico$/.test(path)) return 'ico';

    // Check query params used by common CDNs (e.g. format=webp, fm=jpg, ext=png)
    for (const param of ['format', 'fm', 'ext', 'auto']) {
      const val = parsed.searchParams.get(param)?.toLowerCase();
      if (val) {
        if (val === 'jpg' || val === 'jpeg') return 'jpeg';
        if (val === 'png') return 'png';
        if (val === 'webp') return 'webp';
        if (val === 'avif') return 'avif';
        if (val === 'gif') return 'gif';
        if (val === 'svg') return 'svg';
      }
    }
  } catch {
    // Malformed URL
  }

  return 'unknown';
}

function normalizeMimeSubtype(subtype: string): ImageFormat {
  const clean = subtype.toLowerCase().split('+')[0] ?? '';
  switch (clean) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'gif':
      return 'gif';
    case 'webp':
      return 'webp';
    case 'svg':
    case 'svg-xml':
      return 'svg';
    case 'avif':
      return 'avif';
    case 'bmp':
      return 'bmp';
    case 'x-icon':
    case 'vnd.microsoft.icon':
      return 'ico';
    default:
      return 'unknown';
  }
}

import {
  ALLOWED_IMAGE_PROTOCOLS,
  LIKELY_IMAGE_PATH_EXTENSIONS,
} from './constants';
import type { ImageFormat, VariantRole } from './types';

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
 * Checks `URL.pathname` case-insensitively against known extensions (`spec.md` MVP-04, §6.1),
 * supports trailing slashes (e.g. `/image.jpg/`), colon modifiers (`:large`), CDN transforms,
 * and format query parameters.
 */
export function isLikelyImageLinkHref(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    // Strip trailing slashes and clean CDN modifiers like !sml, !lrg, !preview, and :large
    const trimmedPath = path.replace(/\/+$/, '');
    const cleanPath = trimmedPath.split('!')[0]?.split(':')[0] ?? trimmedPath;

    for (const ext of LIKELY_IMAGE_PATH_EXTENSIONS) {
      if (cleanPath.endsWith(ext)) {
        return true;
      }
    }

    // Check if path has image extension followed by a path slash or separator (e.g. /get_image/.../photo.jpg/1200)
    if (/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)(?:[\/:\s]|$)/i.test(path)) {
      return true;
    }

    // Check query params commonly indicating image formats
    for (const param of ['format', 'fm', 'ext', 'auto', 'type', 'mime']) {
      const val = parsed.searchParams.get(param)?.toLowerCase();
      if (val) {
        if (/^(jpe?g|png|gif|webp|avif|svg|bmp|ico)$/.test(val)) {
          return true;
        }
        if (val.startsWith('image/')) {
          return true;
        }
      }
    }

    // Check if search contains image filename (e.g. ?file=pic.jpg or ?url=...pic.jpg)
    for (const [, val] of parsed.searchParams.entries()) {
      if (/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)(?:[?&#\s]|$)/i.test(val)) {
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
 * 3. File extension in URL pathname (supports !preset suffixes like .jpeg!sml, trailing slashes, :modifiers)
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
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    const path = (trimmedPath.split('!')[0]?.split(':')[0] ?? trimmedPath).toLowerCase();

    if (/\.(jpe?g)(?:[\/:\s]|$)/i.test(path)) return 'jpeg';
    if (/\.png(?:[\/:\s]|$)/i.test(path)) return 'png';
    if (/\.gif(?:[\/:\s]|$)/i.test(path)) return 'gif';
    if (/\.webp(?:[\/:\s]|$)/i.test(path)) return 'webp';
    if (/\.svg(?:[\/:\s]|$)/i.test(path)) return 'svg';
    if (/\.avif(?:[\/:\s]|$)/i.test(path)) return 'avif';
    if (/\.bmp(?:[\/:\s]|$)/i.test(path)) return 'bmp';
    if (/\.ico(?:[\/:\s]|$)/i.test(path)) return 'ico';
    if (/\.tiff?(?:[\/:\s]|$)/i.test(path)) return 'unknown';

    // Check query params used by common CDNs (e.g. format=webp, fm=jpg, ext=png)
    for (const param of ['format', 'fm', 'ext', 'auto', 'type', 'mime']) {
      const val = parsed.searchParams.get(param)?.toLowerCase();
      if (val) {
        if (val === 'jpg' || val === 'jpeg' || val === 'image/jpeg') return 'jpeg';
        if (val === 'png' || val === 'image/png') return 'png';
        if (val === 'webp' || val === 'image/webp') return 'webp';
        if (val === 'avif' || val === 'image/avif') return 'avif';
        if (val === 'gif' || val === 'image/gif') return 'gif';
        if (val === 'svg' || val === 'image/svg+xml') return 'svg';
        if (val === 'bmp' || val === 'image/bmp') return 'bmp';
        if (val === 'ico' || val === 'image/x-icon') return 'ico';
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

/**
 * Selects the optimal high-resolution variant URL for a candidate group.
 * Priority:
 * 1. `link-target` (enclosing modal / full-size link from gallery thumbnail)
 * 2. Highest `srcset` descriptor (e.g. 3x > 2x, or largest width 2000w > 1000w)
 * 3. Largest known natural pixel dimensions
 * 4. `current-src` / `src` / fallback to first
 */
export function pickBestVariantUrl(
  variants: Array<{
    url: string;
    roles: VariantRole[];
    descriptors?: string[];
    naturalWidth?: number | null;
    naturalHeight?: number | null;
  }>,
): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0]!.url;

  // 1. Prioritize link-target (modal / full size image link enclosing thumbnail)
  const linkTarget = variants.find((v) => v.roles.includes('link-target'));
  if (linkTarget) {
    return linkTarget.url;
  }

  // 2. Prioritize srcset descriptor (3x > 2x, or largest width)
  let bestDescScore = -1;
  let bestDescUrl: string | null = null;
  for (const v of variants) {
    for (const d of v.descriptors || []) {
      const wMatch = /^(\d+)w$/i.exec(d.trim());
      if (wMatch?.[1]) {
        const width = Number(wMatch[1]);
        if (width > bestDescScore) {
          bestDescScore = width;
          bestDescUrl = v.url;
        }
      }
      const xMatch = /^([\d.]+)x$/i.exec(d.trim());
      if (xMatch?.[1]) {
        const density = Number(xMatch[1]) * 1000;
        if (density > bestDescScore) {
          bestDescScore = density;
          bestDescUrl = v.url;
        }
      }
    }
  }
  if (bestDescUrl && bestDescScore > 1000) {
    return bestDescUrl;
  }

  // 3. Prioritize largest known natural pixel dimensions
  let maxArea = 0;
  let bestAreaUrl: string | null = null;
  for (const v of variants) {
    if (v.naturalWidth && v.naturalHeight) {
      const area = v.naturalWidth * v.naturalHeight;
      if (area > maxArea) {
        maxArea = area;
        bestAreaUrl = v.url;
      }
    }
  }
  if (bestAreaUrl && maxArea > 0) {
    return bestAreaUrl;
  }

  // 4. Fallback to current-src or src or first variant
  const currentSrc = variants.find((v) => v.roles.includes('current-src'));
  if (currentSrc) return currentSrc.url;

  const src = variants.find((v) => v.roles.includes('src'));
  if (src) return src.url;

  return variants[0]!.url;
}

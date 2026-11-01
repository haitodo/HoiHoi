import {
  INLINE_DATA_URL_SESSION_MAX_CHARS,
  LAZY_SRC_ATTR_ALLOWLIST,
  LAZY_SRCSET_ATTR_ALLOWLIST,
} from '@shared/constants';
import type {
  DetectionSource,
  RawCandidateGroup,
  RawVariantCandidate,
  VariantRole,
} from '@shared/types';
import {
  extractCssBackgroundUrls,
  isLikelyImageLinkHref,
  parseSrcset,
  resolveAndValidateImageUrl,
} from '@shared/url-utils';

export interface ExtractorContext {
  baseUri: string;
  elementIdMap: WeakMap<Element, number>;
  nextElementId: () => number;
  largeDataUrlStore: Map<string, string>;
  domOrderCounter: () => number;
}

/**
 * Handles huge `data:` URLs (e.g. multi-megabyte inline PNGs) to keep Background SW
 * session storage far away from the hard 10MB `QUOTA_BYTES` limit (`design.md` §7.2).
 */
function normalizeAndRegisterCandidate(
  url: string,
  role: VariantRole,
  source: DetectionSource,
  naturalWidth: number | null,
  naturalHeight: number | null,
  descriptor: string | undefined,
  ctx: ExtractorContext,
): RawVariantCandidate {
  let storedUrl = url;
  let largeDataRefId: string | undefined;

  if (url.startsWith('data:') && url.length > INLINE_DATA_URL_SESSION_MAX_CHARS) {
    // Generate a deterministic reference id based on length and timestamp
    largeDataRefId = `data_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ctx.largeDataUrlStore.set(largeDataRefId, url);
    // Keep only the first 256 chars (MIME header preview) in `url` so it remains human-readable
    storedUrl = `${url.slice(0, 256)}...[large-data-url-truncated]`;
  }

  return {
    url: storedUrl,
    role,
    source,
    descriptor,
    naturalWidth,
    naturalHeight,
    largeDataRefId,
  };
}

function getElementKey(el: Element, ctx: ExtractorContext): string {
  let id = ctx.elementIdMap.get(el);
  if (id === undefined) {
    id = ctx.nextElementId();
    ctx.elementIdMap.set(el, id);
  }
  return `el_${id}`;
}

/**
 * Extracts a candidate group from an `<img>` element (and its parent `<picture>` if present).
 */
export function extractFromImageElement(
  img: HTMLImageElement,
  ctx: ExtractorContext,
): RawCandidateGroup | null {
  const baseUri = ctx.baseUri;
  const variants: RawVariantCandidate[] = [];
  const addedUrls = new Set<string>();

  // Determine img element natural dimensions if loaded
  const isLoaded = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  const imgNaturalWidth = isLoaded ? img.naturalWidth : null;
  const imgNaturalHeight = isLoaded ? img.naturalHeight : null;

  // 1. Check currentSrc (browser's active display choice)
  let currentSrcUrl: string | null = null;
  if (img.currentSrc) {
    currentSrcUrl = resolveAndValidateImageUrl(img.currentSrc, baseUri);
  }

  // 2. Check direct src attribute
  let directSrcUrl: string | null = null;
  const rawSrc = img.getAttribute('src');
  if (rawSrc) {
    directSrcUrl = resolveAndValidateImageUrl(rawSrc, baseUri);
  }

  // 3. Register primary and direct src variants
  if (currentSrcUrl) {
    variants.push(
      normalizeAndRegisterCandidate(
        currentSrcUrl,
        'current-src',
        'img',
        imgNaturalWidth,
        imgNaturalHeight,
        undefined,
        ctx,
      ),
    );
    addedUrls.add(currentSrcUrl);
  }

  if (directSrcUrl && !addedUrls.has(directSrcUrl)) {
    // If directSrc is different from currentSrc, its natural dimensions are not yet verified
    const isDirectActive = currentSrcUrl === directSrcUrl;
    variants.push(
      normalizeAndRegisterCandidate(
        directSrcUrl,
        'src',
        'img',
        isDirectActive ? imgNaturalWidth : null,
        isDirectActive ? imgNaturalHeight : null,
        undefined,
        ctx,
      ),
    );
    addedUrls.add(directSrcUrl);
  }

  // 4. Check lazy loading single-URL attributes on img
  for (const attr of LAZY_SRC_ATTR_ALLOWLIST) {
    const val = img.getAttribute(attr);
    if (val) {
      const resolved = resolveAndValidateImageUrl(val, baseUri);
      if (resolved && !addedUrls.has(resolved)) {
        variants.push(
          normalizeAndRegisterCandidate(
            resolved,
            'lazy-attr',
            'lazy-attr',
            null,
            null,
            undefined,
            ctx,
          ),
        );
        addedUrls.add(resolved);
      }
    }
  }

  // 5. Check srcset on img
  const rawSrcset = img.getAttribute('srcset');
  if (rawSrcset) {
    const parsed = parseSrcset(rawSrcset, baseUri);
    for (const item of parsed) {
      if (!addedUrls.has(item.url)) {
        const isCurrent = item.url === currentSrcUrl;
        variants.push(
          normalizeAndRegisterCandidate(
            item.url,
            'srcset',
            'img',
            isCurrent ? imgNaturalWidth : null,
            isCurrent ? imgNaturalHeight : null,
            item.descriptor,
            ctx,
          ),
        );
        addedUrls.add(item.url);
      }
    }
  }

  // 6. Check lazy srcset on img
  for (const attr of LAZY_SRCSET_ATTR_ALLOWLIST) {
    const val = img.getAttribute(attr);
    if (val) {
      const parsed = parseSrcset(val, baseUri);
      for (const item of parsed) {
        if (!addedUrls.has(item.url)) {
          variants.push(
            normalizeAndRegisterCandidate(
              item.url,
              'srcset',
              'lazy-attr',
              null,
              null,
              item.descriptor,
              ctx,
            ),
          );
          addedUrls.add(item.url);
        }
      }
    }
  }

  // 7. Check parent <picture> element and its <source> children
  const parent = img.parentElement;
  if (parent && parent.tagName.toLowerCase() === 'picture') {
    const sources = parent.querySelectorAll('source');
    sources.forEach((source) => {
      const srcAttr = source.getAttribute('srcset') || source.getAttribute('src');
      if (srcAttr) {
        const parsed = parseSrcset(srcAttr, baseUri);
        for (const item of parsed) {
          if (!addedUrls.has(item.url)) {
            const isCurrent = item.url === currentSrcUrl;
            variants.push(
              normalizeAndRegisterCandidate(
                item.url,
                'picture-source',
                'picture',
                isCurrent ? imgNaturalWidth : null,
                isCurrent ? imgNaturalHeight : null,
                item.descriptor,
                ctx,
              ),
            );
            addedUrls.add(item.url);
          }
        }
      }

      // Check lazy srcset on source
      for (const attr of LAZY_SRCSET_ATTR_ALLOWLIST) {
        const lazySrcset = source.getAttribute(attr);
        if (lazySrcset) {
          const parsed = parseSrcset(lazySrcset, baseUri);
          for (const item of parsed) {
            if (!addedUrls.has(item.url)) {
              variants.push(
                normalizeAndRegisterCandidate(
                  item.url,
                  'picture-source',
                  'lazy-attr',
                  null,
                  null,
                  item.descriptor,
                  ctx,
                ),
              );
              addedUrls.add(item.url);
            }
          }
        }
      }
    });
  }

  // 8. Check enclosing <a href> image link
  const link = img.closest('a[href]');
  if (link) {
    const href = link.getAttribute('href');
    if (href) {
      const resolved = resolveAndValidateImageUrl(href, baseUri);
      if (resolved && isLikelyImageLinkHref(resolved) && !addedUrls.has(resolved)) {
        variants.push(
          normalizeAndRegisterCandidate(
            resolved,
            'link-target',
            'link-href',
            null,
            null,
            undefined,
            ctx,
          ),
        );
        addedUrls.add(resolved);
      }
    }
  }

  if (variants.length === 0) return null;

  // Primary URL selection priority per design.md §5.2:
  // 1. currentSrc -> 2. directSrc -> 3. first variant
  const primaryUrl = currentSrcUrl || directSrcUrl || variants[0]!.url;
  const elKey = getElementKey(img, ctx);

  return {
    occurrenceKey: `${elKey}::img::${primaryUrl}`,
    primaryUrl,
    domOrder: ctx.domOrderCounter(),
    variants,
  };
}

/**
 * Extracts candidate groups from computed CSS background-image.
 */
export function extractFromCssBackground(
  el: Element,
  ctx: ExtractorContext,
): RawCandidateGroup[] {
  // Avoid computing style on img or picture elements (redundant)
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || tag === 'picture' || tag === 'source' || tag === 'script' || tag === 'style') {
    return [];
  }

  let bgVal = '';
  try {
    bgVal = window.getComputedStyle(el).backgroundImage;
  } catch {
    return [];
  }

  if (!bgVal || bgVal === 'none') return [];

  const urls = extractCssBackgroundUrls(bgVal, ctx.baseUri);
  if (urls.length === 0) return [];

  const elKey = getElementKey(el, ctx);
  const groups: RawCandidateGroup[] = [];

  for (const url of urls) {
    const candidate = normalizeAndRegisterCandidate(
      url,
      'standalone',
      'css-bg',
      null,
      null,
      undefined,
      ctx,
    );
    groups.push({
      occurrenceKey: `${elKey}::css-bg::${url}`,
      primaryUrl: url,
      domOrder: ctx.domOrderCounter(),
      variants: [candidate],
    });
  }

  return groups;
}

/**
 * Extracts candidate group from SVG `<image>` elements.
 */
export function extractFromSvgImage(
  el: SVGImageElement,
  ctx: ExtractorContext,
): RawCandidateGroup | null {
  const rawHref =
    el.href?.baseVal ||
    el.getAttribute('href') ||
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

  if (!rawHref) return null;

  const resolved = resolveAndValidateImageUrl(rawHref, ctx.baseUri);
  if (!resolved) return null;

  const candidate = normalizeAndRegisterCandidate(
    resolved,
    'standalone',
    'svg-image',
    null,
    null,
    undefined,
    ctx,
  );

  const elKey = getElementKey(el, ctx);
  return {
    occurrenceKey: `${elKey}::svg-image::${resolved}`,
    primaryUrl: resolved,
    domOrder: ctx.domOrderCounter(),
    variants: [candidate],
  };
}

/**
 * Extracts candidate group from non-img elements that possess explicit lazy loading attributes.
 */
export function extractFromLazyAttributes(
  el: Element,
  ctx: ExtractorContext,
): RawCandidateGroup | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || tag === 'source') return null;

  for (const attr of LAZY_SRC_ATTR_ALLOWLIST) {
    const val = el.getAttribute(attr);
    if (val) {
      const resolved = resolveAndValidateImageUrl(val, ctx.baseUri);
      if (resolved) {
        const candidate = normalizeAndRegisterCandidate(
          resolved,
          'lazy-attr',
          'lazy-attr',
          null,
          null,
          undefined,
          ctx,
        );
        const elKey = getElementKey(el, ctx);
        return {
          occurrenceKey: `${elKey}::lazy-attr::${resolved}`,
          primaryUrl: resolved,
          domOrder: ctx.domOrderCounter(),
          variants: [candidate],
        };
      }
    }
  }

  return null;
}

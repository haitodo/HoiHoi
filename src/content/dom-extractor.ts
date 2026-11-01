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

/** Detects common 1x1 transparent GIFs or empty SVG placeholders used by lazy loaders */
function isPlaceholderUrl(url: string): boolean {
  if (url.startsWith('data:image/gif;base64,R0lGODlhAQAB')) return true;
  if (url.startsWith('data:image/svg+xml') && url.length < 150) return true;
  if (url === 'about:blank') return true;
  return false;
}

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
    largeDataRefId = `data_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ctx.largeDataUrlStore.set(largeDataRefId, url);
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

  const isLoaded = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  const imgNaturalWidth = isLoaded ? img.naturalWidth : null;
  const imgNaturalHeight = isLoaded ? img.naturalHeight : null;

  // 1. Check currentSrc
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

  // 3. Register primary and direct src variants (skip placeholder data URLs if possible)
  if (currentSrcUrl && !isPlaceholderUrl(currentSrcUrl)) {
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

  if (directSrcUrl && !addedUrls.has(directSrcUrl) && !isPlaceholderUrl(directSrcUrl)) {
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

  // 4. Check lazy loading single-URL attributes on img (e.g. data-src, data-original)
  let primaryLazyUrl: string | null = null;
  for (const attr of LAZY_SRC_ATTR_ALLOWLIST) {
    const val = img.getAttribute(attr);
    if (val) {
      const resolved = resolveAndValidateImageUrl(val, baseUri);
      if (resolved && !isPlaceholderUrl(resolved)) {
        if (!primaryLazyUrl) primaryLazyUrl = resolved;
        if (!addedUrls.has(resolved)) {
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
  }

  // 5. Check srcset on img
  const rawSrcset = img.getAttribute('srcset');
  if (rawSrcset) {
    const parsed = parseSrcset(rawSrcset, baseUri);
    for (const item of parsed) {
      if (!addedUrls.has(item.url) && !isPlaceholderUrl(item.url)) {
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
        if (!addedUrls.has(item.url) && !isPlaceholderUrl(item.url)) {
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
          if (!addedUrls.has(item.url) && !isPlaceholderUrl(item.url)) {
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

  // Fallback: If all candidates were placeholders, allow directSrcUrl as last resort
  if (variants.length === 0) {
    const fallback = directSrcUrl || currentSrcUrl;
    if (fallback) {
      variants.push(
        normalizeAndRegisterCandidate(
          fallback,
          'src',
          'img',
          imgNaturalWidth,
          imgNaturalHeight,
          undefined,
          ctx,
        ),
      );
    }
  }

  if (variants.length === 0) return null;

  // Primary URL selection priority:
  // If currentSrc is valid and non-placeholder -> currentSrcUrl
  // Else if lazy data-src exists -> primaryLazyUrl
  // Else directSrcUrl -> first variant
  let primaryUrl = currentSrcUrl && !isPlaceholderUrl(currentSrcUrl) ? currentSrcUrl : null;
  if (!primaryUrl && primaryLazyUrl) primaryUrl = primaryLazyUrl;
  if (!primaryUrl && directSrcUrl && !isPlaceholderUrl(directSrcUrl)) primaryUrl = directSrcUrl;
  if (!primaryUrl) primaryUrl = variants[0]!.url;

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
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || tag === 'picture' || tag === 'source' || tag === 'script' || tag === 'style') {
    return [];
  }

  // Quick check inline style first for speed
  let bgVal = (el as HTMLElement).style?.backgroundImage;
  if (!bgVal || bgVal === 'none') {
    try {
      bgVal = window.getComputedStyle(el).backgroundImage;
    } catch {
      return [];
    }
  }

  if (!bgVal || bgVal === 'none') return [];

  const urls = extractCssBackgroundUrls(bgVal, ctx.baseUri);
  if (urls.length === 0) return [];

  const elKey = getElementKey(el, ctx);
  const groups: RawCandidateGroup[] = [];

  for (const url of urls) {
    if (isPlaceholderUrl(url)) continue;
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
  if (!resolved || isPlaceholderUrl(resolved)) return null;

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
      if (resolved && !isPlaceholderUrl(resolved)) {
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

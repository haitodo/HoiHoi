import { LAZY_SRC_ATTR_ALLOWLIST, MAX_ITEMS_PER_TAB } from '@shared/constants';
import { getXasiatAlbumImageSelector, isSupportedAlbumUrl } from '@shared/album-utils';
import type { PaginationLink } from '@shared/pagination-utils';
import { isLikelyImageLinkHref, resolveAndValidateImageUrl } from '@shared/url-utils';
import type { RawCandidateGroup } from '@shared/types';
import type { CollectionPage } from './page-collector';
import { extractFromCssBackground, extractFromImageElement, extractFromLazyAttributes, extractFromSvgImage, type ExtractorContext } from './dom-extractor';

function inPagination(element: Element): boolean {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
    const label = `${current.getAttribute('class') ?? ''} ${current.id} ${current.getAttribute('aria-label') ?? ''}`;
    if (/(?:pagination|page[-_ ]?numbers|pager|paging|page navigation|ページ(?:送り|ナビ)|ページネーション)/i.test(label)) return true;
  }
  return false;
}

export function extractPaginationLinks(doc: Document, baseUri: string): PaginationLink[] {
  return Array.from(doc.querySelectorAll('a[href], link[rel][href]')).slice(0, 10_000).flatMap((element) => {
    try {
      return [{ href: new URL(element.getAttribute('href')!, baseUri).href, rel: element.getAttribute('rel') ?? '',
        label: element.getAttribute('aria-label') || element.textContent || '', inPagination: inPagination(element) }];
    } catch { return []; }
  });
}

/** Reads inert documents without inserting nodes or executing page scripts. */
export function parseCollectionDocument(doc: Document, url: string, ctx: ExtractorContext): CollectionPage {
  // Resolve links as the browser does. An external <base> must not be silently rebased into this site's pager.
  let baseUri = url;
  const rawBase = doc.querySelector('base[href]')?.getAttribute('href');
  if (rawBase) {
    try { baseUri = new URL(rawBase, url).href; } catch { /* Fall back to the source document URL. */ }
  }
  ctx = { ...ctx, baseUri };
  const albumSelector = getXasiatAlbumImageSelector(url) ?? (isSupportedAlbumUrl(url) ? 'img.album-photo' : undefined);
  const root = albumSelector ? doc : doc.querySelector('main, [role="main"]') ?? doc.body;
  const selector = albumSelector ?? [
    'img', 'svg image', 'a[href]', '[style]', ...LAZY_SRC_ATTR_ALLOWLIST.map((attribute) => `[${attribute}]`),
  ].join(',');
  const groups: RawCandidateGroup[] = [];
  for (const element of root.querySelectorAll(selector)) {
    if (groups.length >= MAX_ITEMS_PER_TAB) break;
    if (!albumSelector && (element.closest('nav, aside, footer, form, [role="navigation"], [role="complementary"], .related, .recommendations') ||
      (element.closest('header') && !element.closest('article')))) continue;
    let extracted: RawCandidateGroup[] = [];
    const tag = element.tagName.toLowerCase();
    if (tag === 'img') {
      const group = extractFromImageElement(element as HTMLImageElement, ctx);
      if (group) extracted.push(group);
    } else if (tag === 'image') {
      const group = extractFromSvgImage(element as SVGImageElement, ctx);
      if (group) extracted.push(group);
    } else {
      const lazy = extractFromLazyAttributes(element, ctx);
      if (lazy) extracted.push(lazy);
      if ((element as HTMLElement).style?.backgroundImage?.includes('url(')) extracted.push(...extractFromCssBackground(element, ctx));
      if (tag === 'a' && !element.querySelector('img, svg image')) {
        const href = resolveAndValidateImageUrl(element.getAttribute('href') ?? '', baseUri);
        if (href && isLikelyImageLinkHref(href)) extracted.push({ primaryUrl: href, occurrenceKey: '', domOrder: ctx.domOrderCounter(),
          variants: [{ url: href, source: 'link-href', role: 'link-target', naturalWidth: null, naturalHeight: null }] });
      }
    }
    for (const group of extracted) {
      if (groups.length >= MAX_ITEMS_PER_TAB) break;
      groups.push({ ...group, occurrenceKey: `collection:${url}:${groups.length}`,
        variants: group.variants.map((variant) => ({ ...variant, sourcePageUrl: url })) });
    }
  }
  return { url, groups, links: extractPaginationLinks(doc, baseUri) };
}

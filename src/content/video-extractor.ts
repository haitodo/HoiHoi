import {
  INLINE_DATA_URL_SESSION_MAX_CHARS,
  LAZY_SRC_ATTR_ALLOWLIST,
  LAZY_VIDEO_SRC_ATTR_ALLOWLIST,
} from '@shared/constants';
import type {
  RawCandidateGroup,
  RawVideoCandidateGroup,
  RawVideoVariantCandidate,
  VideoDetectionSource,
  VideoVariantRole,
} from '@shared/types';
import { resolveAndValidateImageUrl } from '@shared/url-utils';
import {
  isLikelyVideoUrl,
  isSegmentChunkNoiseUrl,
  parseIso8601Duration,
  resolveAndValidateVideoUrl,
} from '@shared/video-utils';
import type { ExtractorContext } from './dom-extractor';

const MAX_POSTER_SNAPSHOT_EDGE_PX = 280;

function getOrAssignElementId(el: Element, ctx: ExtractorContext): number {
  let id = ctx.elementIdMap.get(el);
  if (id === undefined) {
    id = ctx.nextElementId();
    ctx.elementIdMap.set(el, id);
  }
  return id;
}

/**
 * Passively captures a tiny WebP poster ONLY when the `<video>` element on the page
 * has ALREADY decoded frame data (`readyState >= 2`).
 * Zero network requests, zero media element creation, and silent fallback if CORS-tainted.
 */
export function tryCaptureReadyVideoFrame(video: HTMLVideoElement): string | undefined {
  try {
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return undefined;
    }

    const scale = Math.min(
      1,
      MAX_POSTER_SNAPSHOT_EDGE_PX / Math.max(video.videoWidth, video.videoHeight),
    );
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return undefined;

    ctx2d.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/webp', 0.65);
    if (dataUrl && dataUrl.length <= INLINE_DATA_URL_SESSION_MAX_CHARS) {
      return dataUrl;
    }
  } catch {
    // Cross-origin video without CORS headers throws SecurityError on toDataURL; ignore cleanly
  }
  return undefined;
}

function readPassiveVideoTiming(video: HTMLVideoElement): {
  durationSec: number | null;
  isLive?: boolean;
  videoWidth: number | null;
  videoHeight: number | null;
} {
  const videoWidth = video.videoWidth > 0 ? video.videoWidth : null;
  const videoHeight = video.videoHeight > 0 ? video.videoHeight : null;

  let durationSec: number | null = null;
  let isLive: boolean | undefined;

  if (video.readyState >= 1) {
    const d = video.duration;
    if (d === Number.POSITIVE_INFINITY) {
      isLive = true;
    } else if (Number.isFinite(d) && d > 0) {
      durationSec = d;
    }
  }

  return { durationSec, isLive, videoWidth, videoHeight };
}

function isVideoElementDrmProtected(video: HTMLVideoElement): boolean {
  try {
    return Boolean(video.mediaKeys !== null);
  } catch {
    return false;
  }
}

function registerVideoVariant(
  url: string,
  role: VideoVariantRole,
  source: VideoDetectionSource,
  videoWidth: number | null,
  videoHeight: number | null,
  ctx: ExtractorContext,
  extra?: {
    descriptor?: string;
    mimeHint?: string;
    fileSizeBytes?: number | null;
    isDrmProtected?: boolean;
    isMseStream?: boolean;
  },
): RawVideoVariantCandidate {
  let storedUrl = url;
  let largeDataRefId: string | undefined;

  if (url.startsWith('data:') && url.length > INLINE_DATA_URL_SESSION_MAX_CHARS) {
    largeDataRefId = `vdata_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ctx.largeDataUrlStore.set(largeDataRefId, url);
    const commaIdx = url.indexOf(',');
    const header = commaIdx > 0 ? url.slice(0, commaIdx + 1) : 'data:video/mp4;base64,';
    storedUrl = `${header}__WIC_LARGE_DATA_${largeDataRefId}__`;
  }

  return {
    url: storedUrl,
    role,
    source,
    descriptor: extra?.descriptor,
    mimeHint: extra?.mimeHint,
    videoWidth,
    videoHeight,
    fileSizeBytes: extra?.fileSizeBytes ?? null,
    isDrmProtected: extra?.isDrmProtected,
    isMseStream: extra?.isMseStream,
    largeDataRefId,
  };
}

/**
 * Layer 1A: Passively extracts video candidates and optional poster image from `<video>` + `<source>`.
 * Never triggers `.load()`, `.play()`, or network requests.
 */
export function extractFromVideoElement(
  video: HTMLVideoElement,
  ctx: ExtractorContext,
  isInsideShadowDom = false,
): {
  videoGroup: RawVideoCandidateGroup | null;
  posterImageGroup: RawCandidateGroup | null;
} {
  const elId = getOrAssignElementId(video, ctx);
  const baseUri = video.baseURI || ctx.baseUri;
  const isDrm = isVideoElementDrmProtected(video);
  const { durationSec, isLive, videoWidth, videoHeight } = readPassiveVideoTiming(video);

  // Resolve passive poster image if declared on <video poster="..."> or data-poster
  let posterUrl: string | undefined;
  let posterImageGroup: RawCandidateGroup | null = null;
  const rawPoster =
    video.getAttribute('poster') ||
    video.getAttribute('data-poster') ||
    video.getAttribute('data-thumb');
  if (rawPoster) {
    const validPoster = resolveAndValidateImageUrl(rawPoster, baseUri);
    if (validPoster) {
      posterUrl = validPoster;
      posterImageGroup = {
        occurrenceKey: `el_${elId}::video-poster::${validPoster}`,
        primaryUrl: validPoster,
        domOrder: ctx.domOrderCounter(),
        variants: [
          {
            url: validPoster,
            role: 'standalone',
            source: 'video-poster',
            naturalWidth: null,
            naturalHeight: null,
          },
        ],
      };
    }
  } else {
    // Only snapshot if frame is already decoded in memory (0 bytes network cost)
    posterUrl = tryCaptureReadyVideoFrame(video);
  }

  const variants: RawVideoVariantCandidate[] = [];
  const seenUrls = new Set<string>();
  const primarySourceType: VideoDetectionSource = isInsideShadowDom
    ? 'shadow-video'
    : 'video-element';

  const addCandidate = (
    rawUrl: string | null | undefined,
    role: VideoVariantRole,
    source: VideoDetectionSource,
    matchLoadedDims: boolean,
    descriptor?: string,
    mimeHint?: string,
  ) => {
    if (!rawUrl) return;
    const valid = resolveAndValidateVideoUrl(rawUrl, baseUri);
    if (!valid || isSegmentChunkNoiseUrl(valid)) return;
    if (seenUrls.has(valid)) return;
    seenUrls.add(valid);

    variants.push(
      registerVideoVariant(
        valid,
        role,
        source,
        matchLoadedDims ? videoWidth : null,
        matchLoadedDims ? videoHeight : null,
        ctx,
        {
          descriptor,
          mimeHint,
          isDrmProtected: isDrm,
        },
      ),
    );
  };

  // 1. currentSrc (if browser already selected a source)
  if (video.currentSrc) {
    addCandidate(video.currentSrc, 'current-src', primarySourceType, true);
  }

  // 2. Direct src attribute on <video>
  const attrSrc = video.getAttribute('src');
  if (attrSrc) {
    const resolvedSrc = resolveAndValidateVideoUrl(attrSrc, baseUri);
    const isCurrent = Boolean(resolvedSrc && resolvedSrc === video.currentSrc);
    addCandidate(attrSrc, 'src', primarySourceType, isCurrent || !video.currentSrc);
  }

  // 3. Lazy-loading attributes on <video>
  for (const attr of [...LAZY_VIDEO_SRC_ATTR_ALLOWLIST, ...LAZY_SRC_ATTR_ALLOWLIST]) {
    const val = video.getAttribute(attr);
    if (val) {
      addCandidate(val, 'lazy-attr', 'lazy-video-attr', false);
    }
  }

  // 4. Child <source> elements inside <video>
  const sourceEls = video.querySelectorAll('source');
  for (let i = 0; i < sourceEls.length; i++) {
    const sourceEl = sourceEls[i]!;
    const sSrc =
      sourceEl.getAttribute('src') ||
      sourceEl.getAttribute('data-src') ||
      sourceEl.getAttribute('data-video-src');
    const mimeType = sourceEl.getAttribute('type') || undefined;
    const label =
      sourceEl.getAttribute('label') ||
      sourceEl.getAttribute('res') ||
      sourceEl.getAttribute('data-res') ||
      sourceEl.getAttribute('size') ||
      undefined;
    const descriptor = label ? (/^\d+$/.test(label) ? `${label}p` : label) : undefined;
    const resolvedSourceUrl = sSrc ? resolveAndValidateVideoUrl(sSrc, baseUri) : null;
    const matchesCurrent = Boolean(resolvedSourceUrl && resolvedSourceUrl === video.currentSrc);

    addCandidate(
      sSrc,
      'source-tag',
      'video-source',
      matchesCurrent,
      descriptor,
      mimeType,
    );
  }

  // 5. Enclosing <a href="..."> pointing to a downloadable video file
  const enclosingLink = video.closest('a[href]');
  if (enclosingLink) {
    const rawHref = enclosingLink.getAttribute('href');
    if (rawHref) {
      const resolvedHref = resolveAndValidateVideoUrl(rawHref, baseUri);
      if (resolvedHref && isLikelyVideoUrl(resolvedHref)) {
        addCandidate(resolvedHref, 'link-target', 'link-href', false, 'リンク先動画');
      }
    }
  }

  if (variants.length === 0) {
    return { videoGroup: null, posterImageGroup };
  }

  const primaryUrl = variants[0]!.url;
  const videoGroup: RawVideoCandidateGroup = {
    occurrenceKey: `el_${elId}::video::${primaryUrl}`,
    primaryUrl,
    domOrder: ctx.domOrderCounter(),
    durationSec,
    isLive,
    posterUrl,
    variants,
  };

  return { videoGroup, posterImageGroup };
}

/**
 * Layer 1B: Extracts standalone `<a href="*.mp4">` video links and non-`<video>` lazy video containers.
 * Reuses any child `<img>` thumbnail passively as the video card's `posterUrl`!
 */
export function extractFromVideoLinkOrLazyElement(
  el: Element,
  ctx: ExtractorContext,
): RawVideoCandidateGroup | null {
  if (el instanceof HTMLVideoElement || el instanceof HTMLSourceElement) {
    return null;
  }

  const baseUri = el.baseURI || ctx.baseUri;
  const elId = getOrAssignElementId(el, ctx);

  // Case A: <a href="..."> pointing directly to a video file
  if (el instanceof HTMLAnchorElement) {
    // Skip if it wraps a <video> (already merged by extractFromVideoElement)
    if (el.querySelector('video')) return null;

    const rawHref = el.getAttribute('href');
    if (!rawHref) return null;
    const resolved = resolveAndValidateVideoUrl(rawHref, baseUri);
    const typeHint = el.getAttribute('type') || undefined;
    if (!resolved || !isLikelyVideoUrl(resolved, typeHint)) return null;

    // Passively reuse enclosed thumbnail <img> as poster if present
    let posterUrl: string | undefined;
    const childImg = el.querySelector('img');
    if (childImg) {
      const thumbCandidate =
        childImg.currentSrc ||
        childImg.getAttribute('src') ||
        childImg.getAttribute('data-src');
      if (thumbCandidate) {
        posterUrl = resolveAndValidateImageUrl(thumbCandidate, baseUri) ?? undefined;
      }
    }

    return {
      occurrenceKey: `el_${elId}::video-link::${resolved}`,
      primaryUrl: resolved,
      domOrder: ctx.domOrderCounter(),
      durationSec: null,
      posterUrl,
      variants: [
        registerVideoVariant(resolved, 'link-target', 'link-href', null, null, ctx, {
          mimeHint: typeHint,
        }),
      ],
    };
  }

  // Case B: Custom player container with explicit video lazy attributes (e.g. data-video-src, data-mp4)
  const variants: RawVideoVariantCandidate[] = [];
  for (const attr of LAZY_VIDEO_SRC_ATTR_ALLOWLIST) {
    const rawVal = el.getAttribute(attr);
    if (!rawVal) continue;
    const resolved = resolveAndValidateVideoUrl(rawVal, baseUri);
    if (resolved && !isSegmentChunkNoiseUrl(resolved)) {
      // Ensure generic attributes like data-stream actually look like a video URL
      if (
        attr === 'data-mp4' ||
        attr === 'data-webm' ||
        attr === 'data-hls' ||
        isLikelyVideoUrl(resolved)
      ) {
        variants.push(
          registerVideoVariant(resolved, 'lazy-attr', 'lazy-video-attr', null, null, ctx),
        );
      }
    }
  }

  if (variants.length === 0) return null;

  let posterUrl: string | undefined;
  const rawPoster = el.getAttribute('data-poster') || el.getAttribute('data-thumb');
  if (rawPoster) {
    posterUrl = resolveAndValidateImageUrl(rawPoster, baseUri) ?? undefined;
  }

  const primaryUrl = variants[0]!.url;
  return {
    occurrenceKey: `el_${elId}::lazy-video::${primaryUrl}`,
    primaryUrl,
    domOrder: ctx.domOrderCounter(),
    durationSec: null,
    posterUrl,
    variants,
  };
}

/**
 * Layer 2: Passively extracts video URLs, posters, dimensions, and ISO-8601 durations from
 * OpenGraph `<meta>` tags and `<script type="application/ld+json">` `VideoObject` entries.
 */
export function extractPageMetadataVideos(
  doc: Document,
  ctx: ExtractorContext,
): RawVideoCandidateGroup[] {
  const groups: RawVideoCandidateGroup[] = [];
  const baseUri = doc.baseURI || ctx.baseUri;

  // 1. OpenGraph & Twitter stream meta tags
  const ogImageMeta = doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
  const ogPosterUrl = ogImageMeta?.getAttribute('content')
    ? (resolveAndValidateImageUrl(ogImageMeta.getAttribute('content')!, baseUri) ?? undefined)
    : undefined;

  const ogWidthRaw = Number(
    doc.querySelector('meta[property="og:video:width"]')?.getAttribute('content') || 0,
  );
  const ogHeightRaw = Number(
    doc.querySelector('meta[property="og:video:height"]')?.getAttribute('content') || 0,
  );
  const ogTypeHint =
    doc.querySelector('meta[property="og:video:type"]')?.getAttribute('content') || undefined;
  const ogDurationSec = parseIso8601Duration(
    doc.querySelector('meta[property="og:video:duration"], meta[property="video:duration"]')?.getAttribute('content'),
  );

  const metaSelectors = [
    'meta[property="og:video:secure_url"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video"]',
    'meta[name="twitter:player:stream"]',
  ];

  const metaUrls = new Set<string>();
  for (const sel of metaSelectors) {
    const metas = doc.querySelectorAll(sel);
    for (let i = 0; i < metas.length; i++) {
      const content = metas[i]?.getAttribute('content');
      if (!content) continue;
      const resolved = resolveAndValidateVideoUrl(content, baseUri);
      if (resolved && isLikelyVideoUrl(resolved, ogTypeHint) && !metaUrls.has(resolved)) {
        metaUrls.add(resolved);
        groups.push({
          occurrenceKey: `meta::ogp::${resolved}`,
          primaryUrl: resolved,
          domOrder: ctx.domOrderCounter(),
          durationSec: ogDurationSec,
          posterUrl: ogPosterUrl,
          variants: [
            registerVideoVariant(
              resolved,
              'metadata',
              'meta-ogp',
              ogWidthRaw > 0 ? ogWidthRaw : null,
              ogHeightRaw > 0 ? ogHeightRaw : null,
              ctx,
              { mimeHint: ogTypeHint },
            ),
          ],
        });
      }
    }
  }

  // 2. JSON-LD VideoObject structured data
  const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < ldScripts.length; i++) {
    const rawJson = ldScripts[i]?.textContent?.trim();
    if (!rawJson || !rawJson.includes('VideoObject')) continue;

    try {
      const parsed: unknown = JSON.parse(rawJson);
      const videoObjects: Array<Record<string, unknown>> = [];
      collectJsonLdVideoObjects(parsed, videoObjects);

      for (const vo of videoObjects) {
        const rawContentUrl = typeof vo.contentUrl === 'string' ? vo.contentUrl : undefined;
        if (!rawContentUrl) continue;

        const encodingFormat =
          typeof vo.encodingFormat === 'string' ? vo.encodingFormat : undefined;
        const resolvedUrl = resolveAndValidateVideoUrl(rawContentUrl, baseUri);
        if (!resolvedUrl || !isLikelyVideoUrl(resolvedUrl, encodingFormat)) continue;

        let posterUrl: string | undefined;
        const rawThumb = Array.isArray(vo.thumbnailUrl) ? vo.thumbnailUrl[0] : vo.thumbnailUrl;
        if (typeof rawThumb === 'string') {
          posterUrl = resolveAndValidateImageUrl(rawThumb, baseUri) ?? undefined;
        }

        const durationSec = parseIso8601Duration(vo.duration);
        const width = parseDimensionValue(vo.width);
        const height = parseDimensionValue(vo.height);

        groups.push({
          occurrenceKey: `meta::jsonld::${resolvedUrl}`,
          primaryUrl: resolvedUrl,
          domOrder: ctx.domOrderCounter(),
          durationSec,
          posterUrl: posterUrl ?? ogPosterUrl,
          variants: [
            registerVideoVariant(resolvedUrl, 'metadata', 'json-ld', width, height, ctx, {
              mimeHint: encodingFormat,
            }),
          ],
        });
      }
    } catch {
      // Ignore malformed JSON-LD blocks on page
    }
  }

  return groups;
}

function collectJsonLdVideoObjects(
  node: unknown,
  out: Array<Record<string, unknown>>,
  depth = 0,
): void {
  if (depth > 8 || !node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectJsonLdVideoObjects(item, out, depth + 1);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  const typeVal = record['@type'];
  const isVideoObject =
    typeVal === 'VideoObject' ||
    (Array.isArray(typeVal) && typeVal.includes('VideoObject'));

  if (isVideoObject) {
    out.push(record);
  }

  for (const val of Object.values(record)) {
    if (val && typeof val === 'object') {
      collectJsonLdVideoObjects(val, out, depth + 1);
    }
  }
}

function parseDimensionValue(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.round(val);
  }
  if (typeof val === 'string') {
    const m = /(\d+)/.exec(val);
    if (m?.[1]) {
      const n = Number(m[1]);
      return n > 0 ? n : null;
    }
  }
  if (val && typeof val === 'object' && 'value' in (val as Record<string, unknown>)) {
    return parseDimensionValue((val as Record<string, unknown>).value);
  }
  return null;
}

/**
 * Traverses Open Shadow Roots on custom web component players to discover inner `<video>` elements.
 */
export function collectShadowDomVideos(root: ParentNode, maxDepth = 4): HTMLVideoElement[] {
  const found: HTMLVideoElement[] = [];
  if (maxDepth <= 0) return found;

  const allElements = root.querySelectorAll('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i]!;
    if (el.shadowRoot) {
      const shadowVideos = el.shadowRoot.querySelectorAll('video');
      for (let j = 0; j < shadowVideos.length; j++) {
        found.push(shadowVideos[j]!);
      }
      const nested = collectShadowDomVideos(el.shadowRoot, maxDepth - 1);
      for (const v of nested) {
        found.push(v);
      }
    }
  }
  return found;
}

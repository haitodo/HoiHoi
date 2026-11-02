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
  extractResolutionHint,
  isKnownAdOrTrackerVideoUrl,
  isLikelyVideoUrl,
  isSegmentChunkNoiseUrl,
  parseIso8601Duration,
  resolveAndValidateVideoUrl,
} from '@shared/video-utils';
import type { ExtractorContext } from './dom-extractor';
import { registerLargeDataUrl } from './large-data-store';

export interface PageFallbackVideoMeta {
  posterUrl?: string;
  durationSec: number | null;
}

const MAX_POSTER_SNAPSHOT_EDGE_PX = 280;
const MAX_SCRIPT_SCAN_CHARS = 64_000;
const MAX_SCRIPT_EXTRACTED_URLS = 30;

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
    largeDataRefId = registerLargeDataUrl(ctx.largeDataUrlStore, url);
    if (!largeDataRefId) throw new Error('WIC_DATA_CACHE_LIMIT');
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
  pageFallbackMeta?: PageFallbackVideoMeta,
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
    video.getAttribute('data-thumb') ||
    video.getAttribute('slideImage');
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
    // Only snapshot if frame is already decoded in memory (0 bytes network cost), else page fallback
    posterUrl = tryCaptureReadyVideoFrame(video) ?? pageFallbackMeta?.posterUrl;
  }

  const variants: RawVideoVariantCandidate[] = [];
  const variantByOriginalUrl = new Map<string, RawVideoVariantCandidate>();
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
    if (!valid || isSegmentChunkNoiseUrl(valid) || isKnownAdOrTrackerVideoUrl(valid)) return;

    const resHint = extractResolutionHint(descriptor ? `${descriptor} ${valid}` : valid);
    const effectiveDescriptor = descriptor || resHint?.descriptor;
    const effectiveWidth = matchLoadedDims && videoWidth ? videoWidth : (resHint?.width ?? null);
    const effectiveHeight = matchLoadedDims && videoHeight ? videoHeight : (resHint?.height ?? null);

    const existing = variantByOriginalUrl.get(valid);
    if (existing) {
      if (mimeHint && !existing.mimeHint) {
        existing.mimeHint = mimeHint;
      }
      if (effectiveDescriptor && !existing.descriptor) {
        existing.descriptor = effectiveDescriptor;
      }
      if (matchLoadedDims) {
        if (videoWidth && !existing.videoWidth) existing.videoWidth = videoWidth;
        if (videoHeight && !existing.videoHeight) existing.videoHeight = videoHeight;
      } else if (effectiveWidth && effectiveHeight && !existing.videoWidth && !existing.videoHeight) {
        existing.videoWidth = effectiveWidth;
        existing.videoHeight = effectiveHeight;
      }
      return;
    }

    const registered = registerVideoVariant(
      valid,
      role,
      source,
      effectiveWidth,
      effectiveHeight,
      ctx,
      {
        descriptor: effectiveDescriptor,
        mimeHint,
        isDrmProtected: isDrm,
      },
    );
    variantByOriginalUrl.set(valid, registered);
    variants.push(registered);
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
    const rawLabel =
      sourceEl.getAttribute('label') ||
      sourceEl.getAttribute('title') ||
      sourceEl.getAttribute('res') ||
      sourceEl.getAttribute('data-res') ||
      sourceEl.getAttribute('data-quality') ||
      sourceEl.getAttribute('size') ||
      (sourceEl.hasAttribute('data-fluid-hd') ? 'HD' : undefined) ||
      undefined;
    const label = rawLabel?.trim();
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

  const effectiveDurationSec =
    durationSec ?? (!isLive ? (pageFallbackMeta?.durationSec ?? null) : null);

  const primaryUrl = variants[0]!.url;
  const videoGroup: RawVideoCandidateGroup = {
    occurrenceKey: `el_${elId}::video::${primaryUrl}`,
    primaryUrl,
    domOrder: ctx.domOrderCounter(),
    durationSec: effectiveDurationSec,
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
    if (!resolved || !isLikelyVideoUrl(resolved, typeHint) || isKnownAdOrTrackerVideoUrl(resolved)) {
      return null;
    }

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

    // Extract resolution hint from link text, title, aria-label, or resolved URL
    const textContext = [
      el.textContent,
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      resolved,
    ]
      .filter(Boolean)
      .join(' ');
    const resHint = extractResolutionHint(textContext);

    return {
      occurrenceKey: `el_${elId}::video-link::${resolved}`,
      primaryUrl: resolved,
      domOrder: ctx.domOrderCounter(),
      durationSec: null,
      posterUrl,
      variants: [
        registerVideoVariant(
          resolved,
          'link-target',
          'link-href',
          resHint?.width ?? null,
          resHint?.height ?? null,
          ctx,
          {
            descriptor: resHint?.descriptor,
            mimeHint: typeHint,
          },
        ),
      ],
    };
  }

  // Case B: Custom player container with explicit video lazy attributes (e.g. data-video-src, data-mp4)
  const variants: RawVideoVariantCandidate[] = [];
  for (const attr of LAZY_VIDEO_SRC_ATTR_ALLOWLIST) {
    const rawVal = el.getAttribute(attr);
    if (!rawVal) continue;
    const resolved = resolveAndValidateVideoUrl(rawVal, baseUri);
    if (resolved && !isSegmentChunkNoiseUrl(resolved) && !isKnownAdOrTrackerVideoUrl(resolved)) {
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
 * Extracts page-level OpenGraph poster & duration metadata so primary `<video preload="none">`
 * elements on watch pages can display duration & thumbnail before playback starts.
 */
export function extractPageFallbackVideoMeta(
  doc: Document,
  baseUriOverride?: string,
): PageFallbackVideoMeta {
  const baseUri = baseUriOverride || doc.baseURI;
  const ogImageMeta = doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
  const posterUrl = ogImageMeta?.getAttribute('content')
    ? (resolveAndValidateImageUrl(ogImageMeta.getAttribute('content')!, baseUri) ?? undefined)
    : undefined;
  const durationSec = parseIso8601Duration(
    doc
      .querySelector('meta[property="og:video:duration"], meta[property="video:duration"]')
      ?.getAttribute('content'),
  );
  return { posterUrl, durationSec };
}

/**
 * Layer 2: Passively extracts video URLs, posters, dimensions, and ISO-8601 durations from
 * OpenGraph `<meta>` tags and `<script type="application/ld+json">` `VideoObject` entries.
 */
export function* iteratePageMetadataVideos(
  doc: Document,
  ctx: ExtractorContext,
): Generator<RawVideoCandidateGroup | undefined> {
  const baseUri = doc.baseURI || ctx.baseUri;

  // 1. OpenGraph & Twitter stream meta tags
  const { posterUrl: ogPosterUrl, durationSec: ogDurationSec } = extractPageFallbackVideoMeta(
    doc,
    baseUri,
  );

  const ogWidthRaw = Number(
    doc.querySelector('meta[property="og:video:width"]')?.getAttribute('content') || 0,
  );
  const ogHeightRaw = Number(
    doc.querySelector('meta[property="og:video:height"]')?.getAttribute('content') || 0,
  );
  const ogTypeHint =
    doc.querySelector('meta[property="og:video:type"]')?.getAttribute('content') || undefined;

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
      yield undefined;
      const content = metas[i]?.getAttribute('content');
      if (!content) continue;
      const resolved = resolveAndValidateVideoUrl(content, baseUri);
      if (
        resolved &&
        isLikelyVideoUrl(resolved, ogTypeHint) &&
        !isKnownAdOrTrackerVideoUrl(resolved) &&
        !metaUrls.has(resolved)
      ) {
        metaUrls.add(resolved);
        yield {
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
        };
      }
    }
  }

  // 2. JSON-LD VideoObject structured data
  const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (let i = 0; i < ldScripts.length; i++) {
    yield undefined;
    const rawJson = ldScripts[i]?.textContent?.trim();
    if (!rawJson || rawJson.length > 128_000 || !rawJson.includes('VideoObject')) continue;

    try {
      const parsed: unknown = JSON.parse(rawJson);
      const videoObjects: Array<Record<string, unknown>> = [];
      collectJsonLdVideoObjects(parsed, videoObjects);

      for (const vo of videoObjects) {
        yield undefined;
        const rawContentUrl = typeof vo.contentUrl === 'string' ? vo.contentUrl : undefined;
        if (!rawContentUrl) continue;

        const encodingFormat =
          typeof vo.encodingFormat === 'string' ? vo.encodingFormat : undefined;
        const resolvedUrl = resolveAndValidateVideoUrl(rawContentUrl, baseUri);
        if (
          !resolvedUrl ||
          !isLikelyVideoUrl(resolvedUrl, encodingFormat) ||
          isKnownAdOrTrackerVideoUrl(resolvedUrl)
        ) {
          continue;
        }

        let posterUrl: string | undefined;
        const rawThumb = Array.isArray(vo.thumbnailUrl) ? vo.thumbnailUrl[0] : vo.thumbnailUrl;
        if (typeof rawThumb === 'string') {
          posterUrl = resolveAndValidateImageUrl(rawThumb, baseUri) ?? undefined;
        }

        const durationSec = parseIso8601Duration(vo.duration);
        const width = parseDimensionValue(vo.width);
        const height = parseDimensionValue(vo.height);

        yield {
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
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks on page
    }
  }

}

export function extractPageMetadataVideos(doc: Document, ctx: ExtractorContext): RawVideoCandidateGroup[] {
  return Array.from(iteratePageMetadataVideos(doc, ctx))
    .filter((group): group is RawVideoCandidateGroup => group !== undefined);
}

const QUICK_VIDEO_TOKEN_RE = /(?:\.mp4|\.m3u8|\.webm|\.mov|\.m4v|\.mpd)\b/i;
const EMBEDDED_HTTP_URL_RE = /https?:(?:\/\/|\\\/\\\/)[^\s"'<>`()]+/gi;

function unescapeEmbeddedUrl(raw: string): string {
  return raw
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u003f/gi, '?')
    .replace(/&amp;/gi, '&')
    .replace(/[.,;}\])\\]+$/, '');
}

function collectValidEmbeddedVideoUrls(text: string, baseUri: string, out: string[]): void {
  if (!text || !QUICK_VIDEO_TOKEN_RE.test(text)) return;
  const bounded = text.length > MAX_SCRIPT_SCAN_CHARS ? text.slice(0, MAX_SCRIPT_SCAN_CHARS) : text;
  EMBEDDED_HTTP_URL_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = EMBEDDED_HTTP_URL_RE.exec(bounded)) !== null) {
    if (out.length >= MAX_SCRIPT_EXTRACTED_URLS) break;
    const cleaned = unescapeEmbeddedUrl(match[0]);
    const resolved = resolveAndValidateVideoUrl(cleaned, baseUri);
    if (
      resolved &&
      isLikelyVideoUrl(resolved) &&
      !isSegmentChunkNoiseUrl(resolved) &&
      !isKnownAdOrTrackerVideoUrl(resolved)
    ) {
      out.push(resolved);
    }
  }
}

/**
 * Layer 2B: Passively scans inline `<script>` player initializers and `data-setup`/`data-config`
 * attributes for embedded `.mp4` / `.m3u8` / `.webm` URLs (including JSON-escaped `https:\/\/...`).
 * Zero network requests and zero polling.
 */
export function* iterateEmbeddedScriptAndConfigVideos(
  doc: Document,
  ctx: ExtractorContext,
  pageFallbackMeta?: PageFallbackVideoMeta,
): Generator<RawVideoCandidateGroup | undefined> {
  const baseUri = doc.baseURI || ctx.baseUri;
  const seenUrls = new Set<string>();

  // 1. Player configuration attributes on DOM elements (grouped per player container)
  const configAttrs = ['data-setup', 'data-config', 'data-options', 'data-player', 'flashvars'];
  const configEls = doc.querySelectorAll(
    '[data-setup], [data-config], [data-options], [data-player], [flashvars]',
  );
  for (let i = 0; i < configEls.length; i++) {
    yield undefined;
    const el = configEls[i]!;
    const elUrls: string[] = [];
    for (const attr of configAttrs) {
      const val = el.getAttribute(attr);
      if (val) collectValidEmbeddedVideoUrls(val, baseUri, elUrls);
    }
    const uniqueElUrls = elUrls.filter((u) => {
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });
    if (uniqueElUrls.length > 0) {
      const elId = getOrAssignElementId(el, ctx);
      const variants = uniqueElUrls.map((u) => {
        const hint = extractResolutionHint(u);
        return registerVideoVariant(
          u,
          'metadata',
          'script-embed',
          hint?.width ?? null,
          hint?.height ?? null,
          ctx,
          { descriptor: hint?.descriptor },
        );
      });
      yield {
        occurrenceKey: `el_${elId}::config-embed::${variants[0]!.url}`,
        primaryUrl: variants[0]!.url,
        domOrder: ctx.domOrderCounter(),
        durationSec: null,
        variants,
      };
    }
  }

  // 2. Inline <script> blocks (skipping external scripts and already-parsed JSON-LD)
  // Group URLs discovered in the SAME <script> block into a single VideoGroup so multi-quality
  // player configurations (e.g. 1080p, 720p, 480p) form variants of ONE card rather than separate duplicate cards.
  const inlineScripts = doc.querySelectorAll('script:not([src])');
  for (let i = 0; i < inlineScripts.length; i++) {
    yield undefined;
    const scriptEl = inlineScripts[i]!;
    const scriptType = (scriptEl.getAttribute('type') || '').toLowerCase();
    if (scriptType === 'application/ld+json') continue;
    const content = scriptEl.textContent?.slice(0, MAX_SCRIPT_SCAN_CHARS);
    if (!content) continue;

    const blockUrls: string[] = [];
    collectValidEmbeddedVideoUrls(content, baseUri, blockUrls);
    const newUrls = blockUrls.filter((u) => {
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });

    if (newUrls.length === 0) continue;

    const scriptElId = getOrAssignElementId(scriptEl, ctx);
    const variants = newUrls.map((url) => {
      // Find surrounding text context around this URL in script content for quality labels (e.g. "label": "1080p")
      let labelContext = url;
      const idx = content.indexOf(url);
      if (idx !== -1) {
        const start = Math.max(0, idx - 120);
        const end = Math.min(content.length, idx + url.length + 120);
        labelContext = content.slice(start, end);
      }
      const hint = extractResolutionHint(labelContext) ?? extractResolutionHint(url);
      return registerVideoVariant(
        url,
        'metadata',
        'script-embed',
        hint?.width ?? null,
        hint?.height ?? null,
        ctx,
        { descriptor: hint?.descriptor },
      );
    });

    const primaryUrl = variants[0]!.url;
    yield {
      occurrenceKey: `script_${scriptElId}::embed::${primaryUrl}`,
      primaryUrl,
      domOrder: ctx.domOrderCounter(),
      durationSec: newUrls.length === 1 ? (pageFallbackMeta?.durationSec ?? null) : null,
      posterUrl: newUrls.length === 1 ? pageFallbackMeta?.posterUrl : undefined,
      variants,
    };
  }

}

export function extractEmbeddedScriptAndConfigVideos(
  doc: Document, ctx: ExtractorContext, pageFallbackMeta?: PageFallbackVideoMeta,
): RawVideoCandidateGroup[] {
  return Array.from(iterateEmbeddedScriptAndConfigVideos(doc, ctx, pageFallbackMeta))
    .filter((group): group is RawVideoCandidateGroup => group !== undefined);
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

import {
  ALLOWED_IMAGE_PROTOCOLS,
  LIKELY_VIDEO_PATH_EXTENSIONS,
  RESTRICTED_VIDEO_DOMAINS,
} from './constants';
import type {
  DownloadReadiness,
  VideoDeliveryType,
  VideoFormat,
  VideoResolutionTier,
  VideoVariant,
  VideoVariantRole,
} from './types';

/**
 * Resolves a raw video URL against a base URI and validates its protocol.
 * Strictly zero network requests.
 */
export function resolveAndValidateVideoUrl(
  rawUrl: string,
  baseUri: string,
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'about:blank') return null;

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

const AD_VIDEO_DOMAIN_SUFFIXES = [
  'realsrv.com',
  'exoclick.com',
  'magsrv.com',
  'doubleclick.net',
  'googlesyndication.com',
  'imasdk.googleapis.com',
  '2mdn.net',
  'juicyads.com',
  'trafficjunky.net',
  'tsyndicate.com',
  'popads.net',
  'adnxs.com',
];

/**
 * Checks whether a media URL belongs to a known VAST / ad-network server so pre-roll ads
 * never pollute or overwrite main video items.
 */
export function isKnownAdOrTrackerVideoUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return AD_VIDEO_DOMAIN_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/**
 * Strips byte-range query parameters (e.g. Vimeo `&range=0-1000`) from progressive MP4/WebM URLs
 * when needed to recover the full-file URL.
 */
export function stripByteRangeQueryParam(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.searchParams.has('range')) {
      parsed.searchParams.delete('range');
      return parsed.href;
    }
    return urlStr;
  } catch {
    return urlStr;
  }
}

/**
 * Extracts total resource byte length from an HTTP `Content-Range` header (e.g. `"bytes 0-1023/13364887"` -> `13364887`).
 */
export function parseContentRangeTotalBytes(contentRangeHeader?: string | null): number | null {
  if (!contentRangeHeader) return null;
  const m = /\/(\d+)\s*$/.exec(contentRangeHeader.trim());
  if (!m?.[1]) return null;
  const total = Number(m[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/**
 * Filters out fragmented streaming media chunks (`.ts`, `.m4s`, DASH range segments, subtitles, keys)
 * so PerformanceResourceTiming logs never flood the video list with hundreds of 2-second chunks.
 */
export function isSegmentChunkNoiseUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const path = parsed.pathname.toLowerCase();

    // Explicit chunk/caption/encryption extensions
    if (/\.(m4s|ts|aac|m4a|vtt|srt|key|mp3|wav)(?:[\/:\s]|$)/i.test(path)) {
      return true;
    }

    // Common DASH / HLS fMP4 initialization or numbered segment patterns (e.g. seg-1-v1-a1.mp4, chunk_0001.mp4)
    const basename = path.split('/').pop() ?? '';
    if (/^(?:init|seg|segment|chunk|frag|fragment)[-_]\d+/i.test(basename)) {
      return true;
    }

    // Byte-range query params typical of MSE player chunk fetches
    if (
      parsed.searchParams.has('bytestart') ||
      parsed.searchParams.has('byteend') ||
      parsed.searchParams.has('range') ||
      parsed.searchParams.has('sq')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Determines whether a URL (from `<a href>` or `PerformanceResourceTiming`) is likely a video asset or manifest.
 */
export function isLikelyVideoUrl(urlStr: string, mimeHint?: string): boolean {
  if (mimeHint && mimeHint.toLowerCase().startsWith('video/')) {
    return true;
  }
  if (
    mimeHint &&
    /^application\/(?:x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)/i.test(mimeHint.trim())
  ) {
    return true;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    if (isSegmentChunkNoiseUrl(urlStr)) {
      return false;
    }

    const trimmedPath = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    const cleanPath = trimmedPath.split('!')[0]?.split(':')[0] ?? trimmedPath;

    // Exclude HTML / server script pages
    if (/\.(html?|php|aspx?|jsp|cgi|js|mjs|css|json|xml)$/i.test(cleanPath)) {
      return false;
    }

    for (const ext of LIKELY_VIDEO_PATH_EXTENSIONS) {
      if (cleanPath.endsWith(ext)) {
        return true;
      }
    }

    // Check format/mime query parameters used by video CDNs
    for (const param of ['format', 'fm', 'ext', 'mime', 'type', 'content_type']) {
      const val = parsed.searchParams.get(param)?.toLowerCase();
      if (val) {
        if (/^(mp4|webm|mov|m4v|ogv|mkv|avi|m3u8|mpd)$/.test(val)) {
          return true;
        }
        if (val.startsWith('video/') || val.includes('mpegurl') || val.includes('dash+xml')) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Infers canonical `VideoFormat` purely from URL / MIME hint without any HTTP requests.
 */
export function inferVideoFormat(urlStr: string, mimeHint?: string): VideoFormat {
  if (urlStr.startsWith('data:')) {
    const m = /^data:video\/([a-zA-Z0-9+.-]+);/i.exec(urlStr);
    if (m?.[1]) {
      return normalizeVideoMimeSubtype(m[1]);
    }
  }

  if (mimeHint) {
    const cleanMime = mimeHint.split(';')[0]?.trim().toLowerCase() ?? '';
    if (
      cleanMime === 'application/x-mpegurl' ||
      cleanMime === 'application/vnd.apple.mpegurl' ||
      cleanMime === 'audio/mpegurl'
    ) {
      return 'hls';
    }
    if (cleanMime === 'application/dash+xml') {
      return 'dash';
    }
    if (cleanMime.startsWith('video/')) {
      const mapped = normalizeVideoMimeSubtype(cleanMime.slice('video/'.length));
      if (mapped !== 'unknown') return mapped;
    }
  }

  try {
    const parsed = new URL(urlStr);
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    const path = (trimmedPath.split('!')[0]?.split(':')[0] ?? trimmedPath).toLowerCase();

    if (/\.m3u8(?:[\/:\s]|$)/i.test(path)) return 'hls';
    if (/\.mpd(?:[\/:\s]|$)/i.test(path)) return 'dash';
    if (/\.mp4(?:[\/:\s]|$)/i.test(path)) return 'mp4';
    if (/\.webm(?:[\/:\s]|$)/i.test(path)) return 'webm';
    if (/\.mov(?:[\/:\s]|$)/i.test(path) || /\.qt(?:[\/:\s]|$)/i.test(path)) return 'mov';
    if (/\.m4v(?:[\/:\s]|$)/i.test(path)) return 'm4v';
    if (/\.(?:ogv|ogg)(?:[\/:\s]|$)/i.test(path)) return 'ogg';
    if (/\.mkv(?:[\/:\s]|$)/i.test(path)) return 'mkv';
    if (/\.avi(?:[\/:\s]|$)/i.test(path)) return 'avi';

    for (const param of ['format', 'fm', 'ext', 'mime', 'type']) {
      const val = parsed.searchParams.get(param)?.toLowerCase();
      if (val) {
        if (val === 'mp4' || val === 'video/mp4') return 'mp4';
        if (val === 'webm' || val === 'video/webm') return 'webm';
        if (val === 'mov' || val === 'video/quicktime') return 'mov';
        if (val === 'm4v' || val === 'video/x-m4v') return 'm4v';
        if (val === 'ogv' || val === 'ogg' || val === 'video/ogg') return 'ogg';
        if (val === 'm3u8' || val.includes('mpegurl')) return 'hls';
        if (val === 'mpd' || val.includes('dash+xml')) return 'dash';
      }
    }
  } catch {
    // Malformed URL
  }

  return 'unknown';
}

function normalizeVideoMimeSubtype(subtype: string): VideoFormat {
  const clean = subtype.toLowerCase().trim();
  switch (clean) {
    case 'mp4':
    case 'mp4v-es':
      return 'mp4';
    case 'webm':
      return 'webm';
    case 'quicktime':
    case 'mov':
      return 'mov';
    case 'x-m4v':
    case 'm4v':
      return 'm4v';
    case 'ogg':
    case 'ogv':
      return 'ogg';
    case 'x-matroska':
    case 'mkv':
      return 'mkv';
    case 'x-msvideo':
    case 'avi':
      return 'avi';
    default:
      return 'unknown';
  }
}

/**
 * Checks whether a page URL or media URL belongs to a Chrome Web Store policy-restricted video host.
 */
export function isRestrictedVideoHost(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    if (RESTRICTED_VIDEO_DOMAINS.has(hostname)) return true;
    if (hostname.endsWith('.youtube.com') || hostname.endsWith('.googlevideo.com')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Evaluates the Delivery Type and Download Readiness Gate (`video_mode_design.md` §4.1).
 * Ensures only genuinely downloadable single-file candidates are marked `'ready'`.
 */
export function classifyVideoDeliveryAndReadiness(options: {
  url: string;
  format: VideoFormat;
  pageUrl?: string;
  isDrmProtected?: boolean;
  isMseStream?: boolean;
}): {
  deliveryType: VideoDeliveryType;
  readiness: DownloadReadiness;
  blockReason?: string;
} {
  const { url, format, pageUrl, isDrmProtected, isMseStream } = options;

  if (isRestrictedVideoHost(pageUrl) || isRestrictedVideoHost(url)) {
    return {
      deliveryType: 'restricted_host',
      readiness: 'blocked',
      blockReason: 'Chrome Web Store 規約によりこのサイトの動画保存は対象外です',
    };
  }

  if (isDrmProtected) {
    return {
      deliveryType: 'drm_protected',
      readiness: 'blocked',
      blockReason: 'DRM（著作権保護）で暗号化されているため保存できません',
    };
  }

  if (isMseStream) {
    return {
      deliveryType: 'mse_stream',
      readiness: 'blocked',
      blockReason: '分割ストリーミング仮想URL (MSE) のため単一ファイルとして保存できません',
    };
  }

  if (format === 'hls') {
    return {
      deliveryType: 'adaptive_hls',
      readiness: 'stream_manifest',
      blockReason: 'HLSストリーミング配信 (.m3u8) です。URLまたは保存コマンドをコピーできます',
    };
  }

  if (format === 'dash') {
    return {
      deliveryType: 'adaptive_dash',
      readiness: 'stream_manifest',
      blockReason: 'DASHストリーミング配信 (.mpd) です。URLまたは保存コマンドをコピーできます',
    };
  }

  if (url.startsWith('blob:')) {
    return {
      deliveryType: 'blob_candidate',
      readiness: 'ready',
    };
  }

  return {
    deliveryType: 'direct',
    readiness: 'ready',
  };
}

/**
 * Orientation-agnostic resolution tier classification (`video_mode_design.md` §6.2).
 * Handles landscape (1920x1080), portrait Shorts/Reels (1080x1920), and ultrawide (1920x800) accurately.
 */
export function getVideoResolutionTier(
  width: number | null | undefined,
  height: number | null | undefined,
): Exclude<VideoResolutionTier, 'all'> | 'unknown' {
  if (!width || !height || width <= 0 || height <= 0) {
    return 'unknown';
  }
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);

  if (shortSide >= 2160 || longSide >= 3840) return '4k';
  if (shortSide >= 1080 || longSide >= 1920) return '1080p';
  if (shortSide >= 720 || longSide >= 1280) return '720p';
  return 'sd';
}

export function matchesMinResolutionTier(
  width: number | null | undefined,
  height: number | null | undefined,
  minTier: VideoResolutionTier,
): boolean | 'unknown' {
  if (minTier === 'all') return true;
  const actual = getVideoResolutionTier(width, height);
  if (actual === 'unknown') return 'unknown';

  const rank: Record<Exclude<VideoResolutionTier, 'all'>, number> = {
    sd: 1,
    '720p': 2,
    '1080p': 3,
    '4k': 4,
  };
  return rank[actual] >= rank[minTier];
}

export function formatResolutionLabel(
  width: number | null | undefined,
  height: number | null | undefined,
): string {
  const tier = getVideoResolutionTier(width, height);
  if (tier === 'unknown' || !width || !height) return '解像度未取得';
  const badge = tier === '4k' ? '4K' : tier.toUpperCase();
  return `${width}×${height} (${badge})`;
}

/**
 * Parses ISO 8601 duration strings (e.g. `"PT1H2M30.5S"`, `"PT45S"`), `"MM:SS"`, or plain numeric seconds
 * strings (e.g. `"285.05"` from OpenGraph `video:duration`) into seconds.
 */
export function parseIso8601Duration(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  // Plain numeric seconds (e.g. <meta property="video:duration" content="285.05">)
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    const secs = Number(str);
    return Number.isFinite(secs) && secs > 0 ? secs : null;
  }

  const isoMatch =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      str,
    );
  if (isoMatch) {
    const days = isoMatch[1] ? Number(isoMatch[1]) : 0;
    const hours = isoMatch[2] ? Number(isoMatch[2]) : 0;
    const minutes = isoMatch[3] ? Number(isoMatch[3]) : 0;
    const seconds = isoMatch[4] ? Number(isoMatch[4]) : 0;
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }

  // Fallback for "HH:MM:SS" or "MM:SS"
  const colonMatch = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(str);
  if (colonMatch) {
    const hours = colonMatch[1] ? Number(colonMatch[1]) : 0;
    const minutes = Number(colonMatch[2]);
    const seconds = Number(colonMatch[3]);
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }

  return null;
}

export function formatVideoDuration(
  durationSec: number | null | undefined,
  isLive?: boolean,
): string {
  if (isLive) return 'LIVE';
  if (durationSec === null || durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) {
    return '--:--';
  }
  const totalSec = Math.round(durationSec);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function formatByteSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Selects the optimal high-quality downloadable variant for a `VideoItem`.
 * Priority:
 * 1. `readiness === 'ready'` over `'stream_manifest'` over `'blocked'`
 * 2. Higher pixel area or resolution descriptor (`2160p` > `1080p` > `720p`)
 * 3. Direct HTTP(S) MP4 over WebM/others
 */
export function pickBestVideoVariantUrl(
  variants: Array<{
    url: string;
    format: VideoFormat;
    readiness: DownloadReadiness;
    roles: VideoVariantRole[];
    descriptors?: string[];
    videoWidth?: number | null;
    videoHeight?: number | null;
    fileSizeBytes?: number | null;
    bitrateBps?: number | null;
  }>,
): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0]!.url;

  const inferDescriptorArea = (rawDesc: string): number => {
    const clean = rawDesc.trim().toLowerCase();
    const pMatch = /(\d{3,4})p\b/i.exec(clean);
    if (pMatch?.[1]) {
      const h = Number(pMatch[1]);
      return Math.round((h * h * 16) / 9);
    }
    if (/\b(?:4k|uhd)\b/.test(clean)) return 3840 * 2160;
    if (/\b(?:2k|qhd)\b/.test(clean)) return 2560 * 1440;
    if (/\b(?:fhd|full\s*hd)\b/.test(clean)) return 1920 * 1080;
    if (/\b(?:hd|high|hq)\b/.test(clean)) return 1280 * 720;
    if (/\b(?:sd|med|medium|standard)\b/.test(clean)) return 640 * 360;
    if (/\b(?:ld|low|lq)\b/.test(clean)) return 426 * 240;
    return 0;
  };

  const scoreVariant = (v: (typeof variants)[number]): number => {
    let score = 0;

    // 1. Readiness gate priority (huge weight so blocked/manifests never overshadow direct MP4s)
    if (v.readiness === 'ready') score += 1_000_000_000;
    else if (v.readiness === 'stream_manifest') score += 100_000_000;

    // 2. Enclosing direct download link bonus
    if (v.roles.includes('link-target') && v.readiness === 'ready') {
      score += 50_000_000;
    }

    // 3. Resolution score (pixel area, descriptor hint like "1080p"/"HD"/"SD", or URL path hint)
    let resScore = 0;
    if (v.videoWidth && v.videoHeight) {
      resScore = v.videoWidth * v.videoHeight;
    } else {
      for (const d of v.descriptors ?? []) {
        resScore = Math.max(resScore, inferDescriptorArea(d));
      }
      if (resScore === 0) {
        if (/\/(?:hd|high|1080p?|720p?)(?:\/|[._-]|$)/i.test(v.url)) {
          resScore = 1280 * 720;
        } else if (/\/(?:sd|low|480p?|360p?)(?:\/|[._-]|$)/i.test(v.url)) {
          resScore = 640 * 360;
        }
      }
    }
    score += Math.min(resScore, 40_000_000);

    // 4. Bitrate tie-breaker
    if (v.bitrateBps && v.bitrateBps > 0) {
      score += Math.min(Math.round(v.bitrateBps / 1000), 500_000);
    }

    // 5. Format compatibility preference (MP4 > WebM > MOV > others)
    if (v.format === 'mp4') score += 5_000;
    else if (v.format === 'webm') score += 3_000;
    else if (v.format === 'mov' || v.format === 'm4v') score += 2_000;

    // 6. Concrete direct CDN URL & known file size tie-breaker (prefers resolved .mp4 over opaque redirect at equal quality)
    if (v.fileSizeBytes && v.fileSizeBytes > 0) {
      score += 500;
    }
    if (/\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(v.url)) {
      score += 250;
    }

    return score;
  };

  let bestUrl = variants[0]!.url;
  let bestScore = -1;

  for (const v of variants) {
    const s = scoreVariant(v);
    if (s > bestScore) {
      bestScore = s;
      bestUrl = v.url;
    }
  }

  return bestUrl;
}

export interface ParsedHlsVariant {
  url: string;
  width: number | null;
  height: number | null;
  bandwidthBps: number | null;
  descriptor: string;
}

/**
 * Pure parser for HLS `.m3u8` playlists.
 * Invoked ONLY when the user explicitly clicks "画質候補を解析" on a stream card.
 */
export function parseHlsMasterPlaylist(
  manifestText: string,
  manifestUrl: string,
): {
  isMasterPlaylist: boolean;
  isDrmEncrypted: boolean;
  variants: ParsedHlsVariant[];
} {
  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  let isDrmEncrypted = false;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      if (/METHOD=(?:SAMPLE-AES|SAMPLE-AES-CTR|SAMPLE-AES-CENC)/i.test(line) || /KEYFORMAT="urn:uuid:/i.test(line)) {
        isDrmEncrypted = true;
      }
    }
  }

  const variants: ParsedHlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const attrs = line.slice('#EXT-X-STREAM-INF:'.length);
    const resMatch = /RESOLUTION=(\d+)x(\d+)/i.exec(attrs);
    const bwMatch = /(?:AVERAGE-)?BANDWIDTH=(\d+)/i.exec(attrs);

    const width = resMatch?.[1] ? Number(resMatch[1]) : null;
    const height = resMatch?.[2] ? Number(resMatch[2]) : null;
    const bandwidthBps = bwMatch?.[1] ? Number(bwMatch[1]) : null;

    // Find next non-empty, non-comment URI line
    let nextUri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]!;
      if (!candidate) continue;
      if (candidate.startsWith('#')) continue;
      nextUri = candidate;
      i = j;
      break;
    }

    if (nextUri) {
      const resolved = resolveAndValidateVideoUrl(nextUri, manifestUrl);
      if (resolved) {
        const parts: string[] = [];
        if (width && height) {
          parts.push(`${Math.min(width, height)}p`);
        }
        if (bandwidthBps) {
          parts.push(`${(bandwidthBps / 1_000_000).toFixed(1)} Mbps`);
        }
        variants.push({
          url: resolved,
          width,
          height,
          bandwidthBps,
          descriptor: parts.join(' • ') || 'HLS Stream',
        });
      }
    }
  }

  // Sort highest resolution / bandwidth first
  variants.sort((a, b) => {
    const areaA = (a.width ?? 0) * (a.height ?? 0);
    const areaB = (b.width ?? 0) * (b.height ?? 0);
    if (areaB !== areaA) return areaB - areaA;
    return (b.bandwidthBps ?? 0) - (a.bandwidthBps ?? 0);
  });

  return {
    isMasterPlaylist: variants.length > 0,
    isDrmEncrypted,
    variants,
  };
}

export interface ParsedHlsMediaSegments {
  isMasterPlaylist: boolean;
  bestMasterVariantUrl?: string;
  isEncrypted: boolean;
  isLiveStream: boolean;
  containerExtension: '.mp4' | '.ts';
  mimeType: 'video/mp4' | 'video/mp2t';
  initSegmentUrl?: string;
  segmentUrls: string[];
}

/**
 * Pure parser for HLS Media Playlists (`.m3u8`) used strictly when the user clicks
 * "結合保存" on an unencrypted VOD HLS stream.
 */
export function parseHlsMediaPlaylist(
  manifestText: string,
  manifestUrl: string,
): ParsedHlsMediaSegments {
  const masterCheck = parseHlsMasterPlaylist(manifestText, manifestUrl);
  if (masterCheck.isMasterPlaylist) {
    return {
      isMasterPlaylist: true,
      bestMasterVariantUrl: masterCheck.variants[0]?.url,
      isEncrypted: masterCheck.isDrmEncrypted,
      isLiveStream: false,
      containerExtension: '.ts',
      mimeType: 'video/mp2t',
      segmentUrls: [],
    };
  }

  const lines = manifestText.split(/\r?\n/).map((l) => l.trim());
  let isEncrypted = false;
  let hasEndList = false;
  let initSegmentUrl: string | undefined;
  const segmentUrls: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('#EXT-X-KEY:')) {
      if (!/METHOD=NONE/i.test(line)) {
        isEncrypted = true;
      }
      continue;
    }

    if (line === '#EXT-X-ENDLIST') {
      hasEndList = true;
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = /URI="([^"]+)"/i.exec(line);
      if (uriMatch?.[1]) {
        const resolvedInit = resolveAndValidateVideoUrl(uriMatch[1], manifestUrl);
        if (resolvedInit) {
          initSegmentUrl = resolvedInit;
        }
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    const resolvedSeg = resolveAndValidateVideoUrl(line, manifestUrl);
    if (resolvedSeg) {
      segmentUrls.push(resolvedSeg);
    }
  }

  const isFmp4 = Boolean(initSegmentUrl) || segmentUrls.some((u) => /\.m4s(?:[?#]|$)/i.test(u));

  return {
    isMasterPlaylist: false,
    isEncrypted,
    isLiveStream: !hasEndList && segmentUrls.length > 0,
    containerExtension: isFmp4 ? '.mp4' : '.ts',
    mimeType: isFmp4 ? 'video/mp4' : 'video/mp2t',
    initSegmentUrl,
    segmentUrls,
  };
}

/**
 * Generates a shell-safe CLI command (`yt-dlp` or `ffmpeg`) for stream manifests when requested by user.
 */
export function buildStreamCliCommand(
  tool: 'yt-dlp' | 'ffmpeg',
  streamUrl: string,
  safeStem = 'video',
): string {
  const escapedUrl = streamUrl.replace(/"/g, '\\"');
  const cleanOut = safeStem.replace(/[\\/:*?"<>|"]/g, '_') || 'video';
  if (tool === 'yt-dlp') {
    return `yt-dlp "${escapedUrl}" -o "${cleanOut}.%(ext)s"`;
  }
  return `ffmpeg -i "${escapedUrl}" -c copy "${cleanOut}.mp4"`;
}

// Re-export VideoVariant helper type check if needed
export function getActiveVideoVariant(
  variants: VideoVariant[],
  selectedUrl: string,
): VideoVariant | undefined {
  return variants.find((v) => v.url === selectedUrl) ?? variants[0];
}

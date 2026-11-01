import { describe, expect, it } from 'vitest';
import { buildSafeVideoDownloadFilename } from '../filename-utils';
import {
  buildStreamCliCommand,
  classifyVideoDeliveryAndReadiness,
  formatByteSize,
  formatVideoDuration,
  getVideoResolutionTier,
  inferVideoFormat,
  isLikelyVideoUrl,
  isSegmentChunkNoiseUrl,
  parseHlsMasterPlaylist,
  parseHlsMediaPlaylist,
  parseIso8601Duration,
  pickBestVideoVariantUrl,
} from '../video-utils';

describe('video-utils', () => {
  describe('isSegmentChunkNoiseUrl & isLikelyVideoUrl', () => {
    it('accepts direct video files and HLS/DASH manifests while rejecting fragmented chunks', () => {
      expect(isLikelyVideoUrl('https://cdn.example.com/media/clip_1080p.mp4')).toBe(true);
      expect(isLikelyVideoUrl('https://cdn.example.com/live/master.m3u8?token=abc')).toBe(true);
      expect(isLikelyVideoUrl('https://cdn.example.com/stream/manifest.mpd')).toBe(true);
      expect(isLikelyVideoUrl('https://cdn.example.com/video?format=webm')).toBe(true);

      // Reject streaming segments and TypeScript source files
      expect(isSegmentChunkNoiseUrl('https://cdn.example.com/hls/seg-0014.ts')).toBe(true);
      expect(isSegmentChunkNoiseUrl('https://cdn.example.com/dash/chunk_002.m4s')).toBe(true);
      expect(isSegmentChunkNoiseUrl('https://cdn.example.com/video.mp4?bytestart=0&byteend=50000')).toBe(true);
      expect(isLikelyVideoUrl('https://cdn.example.com/hls/seg-0014.ts')).toBe(false);
      expect(isLikelyVideoUrl('https://example.com/src/main.ts')).toBe(false);
      expect(isLikelyVideoUrl('https://example.com/watch.html')).toBe(false);
    });
  });

  describe('inferVideoFormat', () => {
    it('infers canonical format from MIME hint, pathname, and query params without network requests', () => {
      expect(inferVideoFormat('https://cdn.example.com/movie.mp4?sig=123')).toBe('mp4');
      expect(inferVideoFormat('https://cdn.example.com/clip.WEBM')).toBe('webm');
      expect(inferVideoFormat('https://cdn.example.com/stream/index.m3u8')).toBe('hls');
      expect(inferVideoFormat('https://cdn.example.com/asset', 'video/quicktime; codecs="avc1"')).toBe('mov');
      expect(inferVideoFormat('https://cdn.example.com/play', 'application/vnd.apple.mpegurl')).toBe('hls');
      expect(inferVideoFormat('blob:https://example.com/1234-5678')).toBe('unknown');
    });
  });

  describe('classifyVideoDeliveryAndReadiness', () => {
    it('marks direct MP4 and unencrypted blob candidates as ready, manifests as stream_manifest, and DRM/YouTube as blocked', () => {
      expect(
        classifyVideoDeliveryAndReadiness({
          url: 'https://cdn.example.com/demo.mp4',
          format: 'mp4',
          pageUrl: 'https://example.com/article',
        }),
      ).toEqual({
        deliveryType: 'direct',
        readiness: 'ready',
      });

      expect(
        classifyVideoDeliveryAndReadiness({
          url: 'blob:https://example.com/abcd',
          format: 'unknown',
          pageUrl: 'https://example.com/editor',
        }),
      ).toEqual({
        deliveryType: 'blob_candidate',
        readiness: 'ready',
      });

      const hlsRes = classifyVideoDeliveryAndReadiness({
        url: 'https://cdn.example.com/master.m3u8',
        format: 'hls',
        pageUrl: 'https://example.com/live',
      });
      expect(hlsRes.deliveryType).toBe('adaptive_hls');
      expect(hlsRes.readiness).toBe('stream_manifest');

      const drmRes = classifyVideoDeliveryAndReadiness({
        url: 'blob:https://cinema.example.com/999',
        format: 'mp4',
        isDrmProtected: true,
      });
      expect(drmRes.deliveryType).toBe('drm_protected');
      expect(drmRes.readiness).toBe('blocked');

      const ytRes = classifyVideoDeliveryAndReadiness({
        url: 'blob:https://www.youtube.com/1111',
        format: 'mp4',
        pageUrl: 'https://www.youtube.com/watch?v=abc',
      });
      expect(ytRes.deliveryType).toBe('restricted_host');
      expect(ytRes.readiness).toBe('blocked');
    });
  });

  describe('getVideoResolutionTier', () => {
    it('classifies landscape, portrait (9:16), and ultrawide (21:9) resolutions accurately', () => {
      expect(getVideoResolutionTier(3840, 2160)).toBe('4k');
      expect(getVideoResolutionTier(1920, 1080)).toBe('1080p');
      expect(getVideoResolutionTier(1080, 1920)).toBe('1080p'); // Portrait Reels/Shorts
      expect(getVideoResolutionTier(1920, 816)).toBe('1080p');  // Cinema ultrawide
      expect(getVideoResolutionTier(720, 1280)).toBe('720p');   // Portrait HD
      expect(getVideoResolutionTier(640, 360)).toBe('sd');
      expect(getVideoResolutionTier(null, null)).toBe('unknown');
    });
  });

  describe('parseIso8601Duration & formatters', () => {
    it('parses ISO 8601 and colon durations accurately', () => {
      expect(parseIso8601Duration('PT1H2M30S')).toBe(3750);
      expect(parseIso8601Duration('PT45.5S')).toBe(45.5);
      expect(parseIso8601Duration('02:14')).toBe(134);
      expect(formatVideoDuration(134)).toBe('2:14');
      expect(formatVideoDuration(3750)).toBe('1:02:30');
      expect(formatVideoDuration(null, true)).toBe('LIVE');
      expect(formatByteSize(50 * 1024 * 1024)).toBe('50.0 MB');
    });
  });

  describe('pickBestVideoVariantUrl', () => {
    it('prioritizes ready direct high-res MP4 over stream manifests or lower resolutions', () => {
      const best = pickBestVideoVariantUrl([
        {
          url: 'https://cdn.example.com/master.m3u8',
          format: 'hls',
          readiness: 'stream_manifest',
          roles: ['source-tag'],
          videoWidth: 3840,
          videoHeight: 2160,
        },
        {
          url: 'https://cdn.example.com/video_720p.mp4',
          format: 'mp4',
          readiness: 'ready',
          roles: ['source-tag'],
          videoWidth: 1280,
          videoHeight: 720,
        },
        {
          url: 'https://cdn.example.com/video_1080p.mp4',
          format: 'mp4',
          readiness: 'ready',
          roles: ['source-tag'],
          videoWidth: 1920,
          videoHeight: 1080,
        },
      ]);
      expect(best).toBe('https://cdn.example.com/video_1080p.mp4');
    });
  });

  describe('parseHlsMasterPlaylist & buildStreamCliCommand', () => {
    it('parses variant streams sorted by resolution and detects SAMPLE-AES DRM', () => {
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720',
        '720p/prog.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=4800000,RESOLUTION=1920x1080',
        'https://cdn.example.com/hls/1080p/prog.m3u8',
      ].join('\n');

      const parsed = parseHlsMasterPlaylist(m3u8, 'https://cdn.example.com/hls/master.m3u8');
      expect(parsed.isMasterPlaylist).toBe(true);
      expect(parsed.isDrmEncrypted).toBe(false);
      expect(parsed.variants).toHaveLength(2);
      expect(parsed.variants[0]?.url).toBe('https://cdn.example.com/hls/1080p/prog.m3u8');
      expect(parsed.variants[1]?.url).toBe('https://cdn.example.com/hls/720p/prog.m3u8');

      const cmd = buildStreamCliCommand('yt-dlp', 'https://cdn.example.com/hls/master.m3u8', 'my:clip');
      expect(cmd).toBe('yt-dlp "https://cdn.example.com/hls/master.m3u8" -o "my_clip.%(ext)s"');
    });
  });

  describe('parseHlsMediaPlaylist', () => {
    it('parses MPEG-TS VOD, fMP4 (#EXT-X-MAP), live streams, and AES-128 encryption', () => {
      const tsVod = [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:6',
        '#EXTINF:6.000,',
        'seg0.ts',
        '#EXTINF:5.500,',
        'seg1.ts',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const parsedTs = parseHlsMediaPlaylist(tsVod, 'https://cdn.example.com/vod/index.m3u8');
      expect(parsedTs.isMasterPlaylist).toBe(false);
      expect(parsedTs.isEncrypted).toBe(false);
      expect(parsedTs.isLiveStream).toBe(false);
      expect(parsedTs.containerExtension).toBe('.ts');
      expect(parsedTs.mimeType).toBe('video/mp2t');
      expect(parsedTs.segmentUrls).toEqual([
        'https://cdn.example.com/vod/seg0.ts',
        'https://cdn.example.com/vod/seg1.ts',
      ]);

      const fmp4Vod = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXTINF:4.0,',
        'chunk0.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n');

      const parsedFmp4 = parseHlsMediaPlaylist(fmp4Vod, 'https://cdn.example.com/fmp4/stream.m3u8');
      expect(parsedFmp4.containerExtension).toBe('.mp4');
      expect(parsedFmp4.mimeType).toBe('video/mp4');
      expect(parsedFmp4.initSegmentUrl).toBe('https://cdn.example.com/fmp4/init.mp4');
      expect(parsedFmp4.segmentUrls).toEqual(['https://cdn.example.com/fmp4/chunk0.m4s']);

      const encryptedOrLive = [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"',
        '#EXTINF:4.0,',
        'live_seg99.ts',
      ].join('\n');

      const parsedEnc = parseHlsMediaPlaylist(
        encryptedOrLive,
        'https://cdn.example.com/live/index.m3u8',
      );
      expect(parsedEnc.isEncrypted).toBe(true);
      expect(parsedEnc.isLiveStream).toBe(true);
    });
  });

  describe('buildSafeVideoDownloadFilename', () => {
    it('builds sanitized folder/filename with proper video extension and overrideExtension', () => {
      const name = buildSafeVideoDownloadFilename({
        targetUrl: 'https://cdn.example.com/videos/Demo%20Clip:Final.mp4?token=1',
        pageTitle: 'Product Showcase | Official',
        domain: 'example.com',
        format: 'mp4',
      });
      expect(name).toBe('Product Showcase_Official/Demo Clip_Final.mp4');

      const mergedHlsName = buildSafeVideoDownloadFilename({
        targetUrl: 'https://cdn.example.com/hls/episode_01_1080p.m3u8?sig=xyz',
        pageTitle: 'Anime Episode 1',
        domain: 'example.com',
        overrideExtension: '.ts',
      });
      expect(mergedHlsName).toBe('Anime Episode 1/episode_01_1080p.ts');
    });
  });
});

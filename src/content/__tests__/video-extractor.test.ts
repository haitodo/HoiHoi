import { describe, expect, it } from 'vitest';
import type { ExtractorContext } from '../dom-extractor';
import {
  extractEmbeddedScriptAndConfigVideos,
  extractFromVideoElement,
} from '../video-extractor';

function createMockContext(baseUri = 'https://www.tokyomotion.net/video/1234567/test'): ExtractorContext {
  let elId = 0;
  let domOrder = 0;
  return {
    baseUri,
    elementIdMap: new WeakMap(),
    nextElementId: () => ++elId,
    largeDataUrlStore: new Map(),
    domOrderCounter: () => ++domOrder,
  };
}

describe('video-extractor', () => {
  it('merges <source type="video/mp4" title="SD/HD"> metadata even when video.currentSrc already seen and filters VAST ads', () => {
    const ctx = createMockContext();

    const makeSource = (attrs: Record<string, string>) => ({
      getAttribute: (name: string) => attrs[name] ?? null,
      hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attrs, name),
    });

    // Simulate TokyoMotion FluidPlayer <video preload="none"> where currentSrc matches SD <source>
    const sdUrl = 'https://www.tokyomotion.net/vsrc/sd/test-sd-source';
    const hdUrl = 'https://www.tokyomotion.net/vsrc/hd/test-hd-source';
    const videoAttrs: Record<string, string> = {
      poster: 'https://cdn.tokyomotion.net/media/videos/tmb/1234567/default.jpg',
      slideImage: 'https://cdn.tokyomotion.net/media/videos/sprites/1234567.jpg',
    };

    const mockVideo = {
      baseURI: ctx.baseUri,
      currentSrc: sdUrl,
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
      duration: Number.NaN,
      mediaKeys: null,
      getAttribute: (name: string) => videoAttrs[name] ?? null,
      querySelectorAll: (sel: string) =>
        sel === 'source'
          ? [
              makeSource({ src: sdUrl, title: 'SD', type: 'video/mp4' }),
              makeSource({ src: hdUrl, title: 'HD', type: 'video/mp4', 'data-fluid-hd': '' }),
            ]
          : [],
      closest: () => null,
    } as unknown as HTMLVideoElement;

    const { videoGroup } = extractFromVideoElement(mockVideo, ctx, false, {
      durationSec: 285.05,
      posterUrl: 'https://cdn.tokyomotion.net/og.jpg',
    });

    expect(videoGroup).not.toBeNull();
    expect(videoGroup?.durationSec).toBe(285.05);
    // Prefers <video poster> over sprite sheet slideImage
    expect(videoGroup?.posterUrl).toBe(
      'https://cdn.tokyomotion.net/media/videos/tmb/1234567/default.jpg',
    );
    expect(videoGroup?.variants).toHaveLength(2);
    expect(videoGroup?.variants[0]).toMatchObject({
      url: sdUrl,
      descriptor: 'SD',
      mimeHint: 'video/mp4',
    });
    expect(videoGroup?.variants[1]).toMatchObject({
      url: hdUrl,
      descriptor: 'HD',
      mimeHint: 'video/mp4',
    });

    // Simulate FluidPlayer temporarily setting currentSrc to a VAST pre-roll ad
    const adMockVideo = {
      ...mockVideo,
      currentSrc: 'https://syndication.realsrv.com/ preroll_ad.mp4'.replace(' ', ''),
    } as unknown as HTMLVideoElement;

    const adResult = extractFromVideoElement(adMockVideo, ctx, false, { durationSec: 285.05 });
    expect(adResult.videoGroup?.variants.map((v) => v.url)).toEqual([sdUrl, hdUrl]);
  });

  it('extracts JSON-escaped video URLs from inline scripts and data-config while ignoring scripts/chunks/ads', () => {
    const ctx = createMockContext('https://video.example.com/watch/99');

    const configEl = {
      getAttribute: (name: string) =>
        name === 'data-config'
          ? '{"sources":[{"file":"https:\\/\\/cdn.example.com\\/media\\/99_1080p.mp4?token=abc\\u0026exp=777"}]}'
          : null,
    };

    const inlineScript = {
      getAttribute: () => null,
      textContent: `
        window.__PLAYER__ = {
          hls: "https:\\/\\/cdn.example.com\\/hls\\/master.m3u8?sig=1",
          ad: "https:\\/\\/cdn.exoclick.com\\/ad_preroll.mp4",
          chunk: "https:\\/\\/cdn.example.com\\/hls\\/seg-001.ts",
          bundle: "https:\\/\\/cdn.example.com\\/player.js"
        };
      `,
    };

    const mockDoc = {
      baseURI: ctx.baseUri,
      querySelectorAll: (selector: string) => {
        if (selector.includes('[data-setup]')) return [configEl];
        if (selector === 'script:not([src])') return [inlineScript];
        return [];
      },
    } as unknown as Document;

    const groups = extractEmbeddedScriptAndConfigVideos(mockDoc, ctx, {
      durationSec: 90,
      posterUrl: 'https://cdn.example.com/thumb.jpg',
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.primaryUrl).toBe('https://cdn.example.com/media/99_1080p.mp4?token=abc&exp=777');
    expect(groups[1]?.primaryUrl).toBe('https://cdn.example.com/hls/master.m3u8?sig=1');
    expect(groups[1]?.durationSec).toBe(90);
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractCssBackgroundUrls,
  inferImageFormat,
  isLikelyImageLinkHref,
  parseSrcset,
  resolveAndValidateImageUrl,
} from '../url-utils';

describe('url-utils', () => {
  describe('resolveAndValidateImageUrl', () => {
    it('resolves relative URLs to absolute URLs with baseUri', () => {
      const result = resolveAndValidateImageUrl('/images/photo.jpg', 'https://example.com/sub/page.html');
      expect(result).toBe('https://example.com/images/photo.jpg');
    });

    it('preserves query strings and hash parameters', () => {
      const result = resolveAndValidateImageUrl('pic.png?w=800&sign=abc#preview', 'https://example.com/');
      expect(result).toBe('https://example.com/pic.png?w=800&sign=abc#preview');
    });

    it('rejects disallowed schemes like javascript:', () => {
      expect(resolveAndValidateImageUrl('javascript:alert(1)', 'https://example.com/')).toBeNull();
      expect(resolveAndValidateImageUrl('vbscript:msgbox', 'https://example.com/')).toBeNull();
    });

    it('allows data: and blob: schemes', () => {
      expect(resolveAndValidateImageUrl('data:image/png;base64,iVBOR', 'https://example.com/')).toBe(
        'data:image/png;base64,iVBOR',
      );
      expect(resolveAndValidateImageUrl('blob:https://example.com/uuid-123', 'https://example.com/')).toBe(
        'blob:https://example.com/uuid-123',
      );
    });
  });

  describe('parseSrcset', () => {
    it('parses simple space/width descriptor srcset', () => {
      const input = 'small.jpg 400w, large.jpg 800w';
      const parsed = parseSrcset(input, 'https://example.com/');
      expect(parsed).toEqual([
        { url: 'https://example.com/small.jpg', descriptor: '400w' },
        { url: 'https://example.com/large.jpg', descriptor: '800w' },
      ]);
    });

    it('handles image URLs with embedded commas without breaking (CDN transforms)', () => {
      const input =
        'https://cdn.example.com/w_400,c_scale/img.jpg 400w, https://cdn.example.com/w_800,c_scale/img.jpg 800w';
      const parsed = parseSrcset(input, 'https://example.com/');
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.url).toBe('https://cdn.example.com/w_400,c_scale/img.jpg');
      expect(parsed[0]?.descriptor).toBe('400w');
      expect(parsed[1]?.url).toBe('https://cdn.example.com/w_800,c_scale/img.jpg');
      expect(parsed[1]?.descriptor).toBe('800w');
    });

    it('parses candidates without descriptors', () => {
      const input = 'a.jpg, b.jpg, c.jpg';
      const parsed = parseSrcset(input, 'https://example.com/');
      expect(parsed.map((p) => p.url)).toEqual([
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ]);
    });
  });

  describe('extractCssBackgroundUrls', () => {
    it('extracts multiple url() items ignoring linear-gradient', () => {
      const css = 'linear-gradient(rgba(0,0,0,0.5)), url("/bg1.png"), url(\'/bg2.jpg\')';
      const urls = extractCssBackgroundUrls(css, 'https://example.com/page/');
      expect(urls).toEqual([
        'https://example.com/bg1.png',
        'https://example.com/bg2.jpg',
      ]);
    });

    it('returns empty array on "none" or empty string', () => {
      expect(extractCssBackgroundUrls('none', 'https://example.com/')).toEqual([]);
      expect(extractCssBackgroundUrls('', 'https://example.com/')).toEqual([]);
    });
  });

  describe('isLikelyImageLinkHref', () => {
    it('returns true for common image file extensions', () => {
      expect(isLikelyImageLinkHref('https://example.com/photos/dog.JPG')).toBe(true);
      expect(isLikelyImageLinkHref('https://example.com/art.png?download=true')).toBe(true);
      expect(isLikelyImageLinkHref('https://example.com/vector.svg')).toBe(true);
    });

    it('returns false for HTML pages and non-image endpoints', () => {
      expect(isLikelyImageLinkHref('https://example.com/photos/view.html')).toBe(false);
      expect(isLikelyImageLinkHref('https://example.com/gallery/123')).toBe(false);
    });
  });

  describe('inferImageFormat', () => {
    it('infers from data: URL MIME', () => {
      expect(inferImageFormat('data:image/webp;base64,AAA')).toBe('webp');
      expect(inferImageFormat('data:image/svg+xml;utf8,<svg>')).toBe('svg');
    });

    it('infers from mimeHint', () => {
      expect(inferImageFormat('https://example.com/fetch-image', 'image/avif')).toBe('avif');
    });

    it('infers from file extension in pathname', () => {
      expect(inferImageFormat('https://example.com/cat.PNG')).toBe('png');
      expect(inferImageFormat('https://example.com/banner.gif')).toBe('gif');
    });

    it('infers from query parameters', () => {
      expect(inferImageFormat('https://example.com/api/render?format=webp&w=400')).toBe('webp');
      expect(inferImageFormat('https://example.com/img?fm=jpg')).toBe('jpeg');
    });

    it('returns unknown when no indicators exist', () => {
      expect(inferImageFormat('https://example.com/dynamic-asset-endpoint')).toBe('unknown');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { isSupportedAlbumUrl, normalizeAlbumPageUrl } from '../album-utils';

const album = 'https://www.v2ph.com/album/a54xo3nz.html?hl=ja';
describe('album pagination scope', () => {
  it('accepts supported albums and canonicalizes first-page and query ordering duplicates', () => {
    expect(isSupportedAlbumUrl(album)).toBe(true);
    expect(normalizeAlbumPageUrl('?page=1&hl=ja#photos', album)).toBe(album);
    expect(normalizeAlbumPageUrl('?page=2&hl=ja', album)).toBe(`${album}&page=2`);
    expect(isSupportedAlbumUrl('https://example.com/album/foo')).toBe(false);
  });
  it.each([
    'https://other.example/album/a54xo3nz.html?hl=ja&page=2',
    '/album/another.html?hl=ja&page=2', '?hl=en&page=2', '?hl=ja&page=0',
    '?hl=ja&page=2&page=3', '?hl=ja&page=10001', '?hl=ja&page=2&download=1',
    'javascript:alert(1)', 'https://user:pass@www.v2ph.com/album/a54xo3nz.html?hl=ja&page=2',
  ])('rejects unrelated or malformed links: %s', (href) => {
    expect(normalizeAlbumPageUrl(href, album)).toBeNull();
  });
});

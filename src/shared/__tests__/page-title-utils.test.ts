import { describe, expect, it } from 'vitest';
import { normalizePageTitleForFolder } from '../page-title-utils';
import { extractPageNumber } from '../pagination-utils';

const page2 = 'https://www.v2ph.com/album/example.html?page=2&hl=ja';

describe('stable folder titles for paginated pages', () => {
  it.each([
    ['写真集 - 2ページ - 微图坊', '写真集 - 微图坊'],
    ['写真集 - 第２ページ目 - 微图坊', '写真集 - 微图坊'],
    ['写真集（2ページ） - 微图坊', '写真集 - 微图坊'],
    ['写真集 - 【ページ 2】 - 微图坊', '写真集 - 微图坊'],
    ['Album | Page 2 of 5 | Site', 'Album | Site'],
    ['Album (Page 2/5) - Site', 'Album - Site'],
    ['Page 2 - Album - Site', 'Album - Site'],
    ['写真集 - 第2页 - Site', '写真集 - Site'],
    ['写真集 - 第2頁 - Site', '写真集 - Site'],
  ])('removes a corroborated pagination decoration from %s', (title, expected) => {
    expect(normalizePageTitleForFolder(title, page2)).toBe(expected);
  });
  it.each([
    '写真集 第2巻 - 微图坊', '写真集 Vol.2 - 微图坊', '写真集 2026 - 微图坊',
    '写真集 - 2 - 微图坊', '写真集 - Part 2 - 微图坊', '2ページの物語 - 微图坊',
    'Album - Page 2 of Life - Site',
  ])('preserves meaningful numbers and non-pagination title content: %s', (title) => {
    expect(normalizePageTitleForFolder(title, page2)).toBe(title);
  });
  it('does not infer page numbering from offsets, post IDs, or absent/ambiguous URL context', () => {
    const title = '写真集 - 2ページ - 微图坊';
    for (const url of [undefined, 'https://example.com/album', 'https://example.com/?p=2',
      'https://example.com/?offset=2', 'https://example.com/?page=3',
      'https://example.com/?page=2&page=3', 'https://example.com/?page=2&paged=3']) {
      expect(normalizePageTitleForFolder(title, url)).toBe(title);
    }
  });
  it('works for known path pagination and retains a title if removing it would leave nothing', () => {
    expect(normalizePageTitleForFolder('Album [Page 2]', 'https://example.com/gallery/page/2/')).toBe('Album');
    expect(normalizePageTitleForFolder('2ページ', page2)).toBe('2ページ');
    expect(extractPageNumber('https://example.com/?PAGE=2')).toBe(2);
    expect(extractPageNumber('https://example.com/?page=bad')).toBeNull();
  });
});

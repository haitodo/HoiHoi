import { describe, expect, it } from 'vitest';
import { detectPaginationScope, hasPaginationEvidence, normalizePaginationUrl, type PaginationLink } from '../pagination-utils';

const base = 'https://photos.example/gallery?tag=flowers';
const number = (href: string): PaginationLink => ({ href, label: '2', inPagination: true });

describe('generic pagination detection', () => {
  it.each(['page', 'paged', 'pageno', 'pg', 'offset', 'start'])('learns %s pagination while preserving filters', (key) => {
    const scope = detectPaginationScope(base, [number(`?tag=flowers&${key}=2`)]);
    const next = normalizePaginationUrl(`https://photos.example/gallery?${key}=3&tag=flowers#content`, scope);
    expect(next).toBe(`https://photos.example/gallery?${key}=3&tag=flowers`);
    expect(normalizePaginationUrl('https://photos.example/gallery?tag=other&page=3', scope)).toBeNull();
    expect(normalizePaginationUrl('https://photos.example/other?tag=flowers&page=3', scope)).toBeNull();
  });
  it('canonicalizes an explicit first page against an observed implicit first page', () => {
    const scope = detectPaginationScope(base, [number('?page=2&tag=flowers')]);
    expect(normalizePaginationUrl(`${base}&page=1`, scope)).toBe(base);
  });
  it('recognizes path pagination and keeps its collection root fixed', () => {
    const scope = detectPaginationScope('https://photos.example/gallery/', [number('/gallery/page/2/')]);
    expect(normalizePaginationUrl('https://photos.example/gallery/page/3/', scope)).toBe('https://photos.example/gallery/page/3/');
    expect(normalizePaginationUrl('https://photos.example/gallery/page/1/', scope)).toBe('https://photos.example/gallery/');
    expect(normalizePaginationUrl('https://photos.example/other/page/3/', scope)).toBeNull();
    const fromMiddle = detectPaginationScope('https://photos.example/gallery/page/3/', [number('/gallery/page/4/')]);
    expect(normalizePaginationUrl('https://photos.example/gallery/', fromMiddle)).toBe('https://photos.example/gallery/');
  });
  it('accepts explicit next links with opaque cursors but does not invent a successor', () => {
    const scope = detectPaginationScope(base, [{ href: '?cursor=abc&tag=flowers', rel: 'next' }]);
    expect(normalizePaginationUrl('https://photos.example/gallery?cursor=def&tag=flowers', scope))
      .toBe('https://photos.example/gallery?cursor=def&tag=flowers');
    expect(normalizePaginationUrl('https://photos.example/gallery?cursor=def&tag=other', scope)).toBeNull();
  });
  it.each([
    [{ href: '?page=2&tag=flowers', label: '2' }],
    [{ href: '/articles/different', rel: 'next', label: '次の記事' }],
    [{ href: '?p=123&tag=flowers', rel: 'next' }],
    [{ href: 'https://external.example/gallery?page=2&tag=flowers', rel: 'next' }],
    [{ href: '?page=2&tag=other', rel: 'next' }],
    [{ href: '?page=2&page=3&tag=flowers', rel: 'next' }],
    [{ href: '?page=0&tag=flowers', rel: 'next' }],
    [{ href: '#next', rel: 'next' }],
    [{ href: 'javascript:loadMore()', rel: 'next' }],
  ])('does not infer collection navigation from an unrelated or insufficient link: %j', (link) => {
    expect(() => detectPaginationScope(base, [link])).toThrow('ページ送りを検出');
  });
  it('does not choose between multiple independent pagers', () => {
    expect(() => detectPaginationScope(base, [number('?page=2&tag=flowers'), number('?offset=20&tag=flowers')]))
      .toThrow('複数のページ送り');
  });
  it('distinguishes page labels from next-article labels in navigation containers', () => {
    expect(hasPaginationEvidence({ href: '?page=2', inPagination: true, label: '次のページ' })).toBe(true);
    expect(hasPaginationEvidence({ href: '?page=2', inPagination: true, label: '次の記事' })).toBe(false);
  });
});

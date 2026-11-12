import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { parseCollectionDocument } from '../page-document';
import { collectPages } from '../page-collector';
import { detectPaginationScope } from '@shared/pagination-utils';

describe('collection from real HTML structures', () => {
  let window: Window;
  const base = 'https://photos.example/gallery?tag=flowers';
  beforeEach(() => { window = new Window({ url: base }); });
  afterEach(async () => { await window.happyDOM.close(); });
  function parse(html: string, url = base) {
    const doc = new window.DOMParser().parseFromString(html, 'text/html') as unknown as Document;
    let order = 0;
    return parseCollectionDocument(doc, url, { baseUri: url, elementIdMap: new WeakMap(),
      largeDataUrlStore: new Map(), nextElementId: () => ++order, domOrderCounter: () => ++order });
  }

  it('extracts lazy images, picture variants, inline backgrounds, SVG images, and image links from the main content', () => {
    const page = parse(`<header><img src="/logo.svg"></header><main><article>
      <header><img src="/hero.jpg"></header>
      <picture><source srcset="/large.webp 1600w" type="image/webp"><img data-src="/lazy.jpg?sig=keep" loading="lazy"></picture>
      <div style="background-image: url('/cover.jpg')"></div>
      <svg><image href="/vector.png"></image></svg><a href="/download.jpg">Download</a>
      </article><aside><img src="/ad.jpg"></aside><nav><img src="/icon.png"></nav>
      <div class="related"><img src="/related.jpg"></div></main><footer><img src="/footer.jpg"></footer>`);
    expect(page.groups.map((group) => group.primaryUrl)).toEqual([
      'https://photos.example/hero.jpg', 'https://photos.example/lazy.jpg?sig=keep',
      'https://photos.example/cover.jpg', 'https://photos.example/vector.png', 'https://photos.example/download.jpg',
    ]);
    expect(page.groups[1]?.variants.map((variant) => variant.url)).toContain('https://photos.example/large.webp');
    expect(page.groups.every((group) => group.variants.every((variant) => variant.sourcePageUrl === base))).toBe(true);
    expect(page.groups.every((group) => group.variants.every((variant) => variant.naturalWidth === null))).toBe(true);
  });
  it('honors an HTML base element without treating external pagination as same-site links', () => {
    const page = parse(`<base href="https://external.example/"><main><img data-src="/photo.jpg?sig=keep"></main>
      <nav aria-label="Page navigation"><a href="?page=2&tag=flowers">2</a></nav>`);
    expect(page.groups[0]?.primaryUrl).toBe('https://external.example/photo.jpg?sig=keep');
    expect(() => detectPaginationScope(base, page.links)).toThrow('ページ送りを検出');
  });
  it('resolves same-origin base paths while retaining the document URL as Referer', () => {
    const page = parse('<base href="/assets/"><main><img data-src="photo.jpg?sig=keep"></main>');
    expect(page.groups[0]?.primaryUrl).toBe('https://photos.example/assets/photo.jpg?sig=keep');
    expect(page.groups[0]?.variants[0]?.sourcePageUrl).toBe(base);
  });
  it('uses v2ph-specific extraction to exclude related album thumbnails', () => {
    const page = parse(`<img class="album-photo" loading="lazy" src="https://cdn.v2ph.com/photos/1.jpg">
      <img src="https://cdn.v2ph.com/album/related.jpg">`, 'https://www.v2ph.com/album/example.html?hl=ja');
    expect(page.groups.map((group) => group.primaryUrl)).toEqual(['https://cdn.v2ph.com/photos/1.jpg']);
  });
  it('collects the Xasiat album photos with their full-size links', () => {
    const url = 'https://www.xasiat.com/albums/12345/example/';
    const photos = Array.from({ length: 14 }, (_, i) => `<a class="item" href="/get_image/2/example/sources/${i}.jpg/">
      <img src="data:image/gif;base64,R0lGODlhAQAB" data-original="https://cdn.example/album/${i}.jpg" width="106" height="150">
      </a>`);
    const page = parse(`<div class="block-album"><div class="album-holder"><div class="images">${photos.join('')}
      </div></div></div><div id="list_albums_related_albums_items"><img src="/related.jpg" width="380" height="507"></div>
      <div class="logo"><img src="/logo.svg"></div>`, url);

    expect(page.groups.map((group) => group.primaryUrl)).toEqual(photos.map((_, i) => `https://cdn.example/album/${i}.jpg`));
    expect(page.groups.map((group) => group.variants.find((variant) => variant.role === 'link-target')?.url))
      .toEqual(photos.map((_, i) => `https://www.xasiat.com/get_image/2/example/sources/${i}.jpg/`));
  });
  it('detects head rel=next and numbered navigation but not adjacent-article links', () => {
    const page = parse(`<head><link rel="next" href="?page=2&tag=flowers"></head><body>
      <main><img src="/1.jpg"></main><div class="pagination"><a href="?page=2&tag=flowers">2</a></div>
      <a rel="next" href="/different-article">次の記事</a></body>`);
    expect(detectPaginationScope(base, page.links).route).toMatchObject({ kind: 'query', parameter: 'page' });
  });
  it('collects a second generic page and follows neither related collections nor adjacent articles', async () => {
    const first = parse(`<main><img src="/1.jpg"></main><nav aria-label="ページ送り">
      <a href="?page=2&tag=flowers">次のページ</a></nav><a rel="next" href="/another-article">次の記事</a>`);
    const readPage = vi.fn(async (url: string) => parse(`<main><img src="/2.jpg"></main><div class="pagination">
      <a href="?tag=flowers">1</a><a href="?page=2&tag=other">3</a></div>`, url));
    const publish = vi.fn(async () => {});
    await collectPages({ initial: first, signal: new AbortController().signal, readPage, onPage: publish, onProgress: vi.fn() });
    expect(readPage).toHaveBeenCalledExactlyOnceWith('https://photos.example/gallery?page=2&tag=flowers');
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('makes no additional requests when a page contains only next-article links or JS-only controls', async () => {
    const page = parse('<main><img src="/1.jpg"></main><a rel="next" href="/next-article">次の記事</a><button>もっと見る</button>');
    const readPage = vi.fn(); const publish = vi.fn();
    await expect(collectPages({ initial: page, signal: new AbortController().signal, readPage,
      onPage: publish, onProgress: vi.fn() })).rejects.toThrow('ページ送りを検出');
    expect(readPage).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  });
});

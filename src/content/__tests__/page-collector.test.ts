import { describe, expect, it, vi } from 'vitest';
import { PAGE_COLLECTION_MAX_PAGES } from '@shared/constants';
import { collectPages, type CollectionPage } from '../page-collector';

const base = 'https://www.v2ph.com/album/example.html?hl=ja';
function page(n: number, links: string[] = []): CollectionPage {
  const url = n === 1 ? base : `${base}&page=${n}`;
  return { url, links: links.map((href) => ({ href })), groups: [{ primaryUrl: `https://cdn.v2ph.com/${n}.jpg`, occurrenceKey: `page${n}`, domOrder: n,
    variants: [{ url: `https://cdn.v2ph.com/${n}.jpg`, role: 'src', source: 'img', naturalWidth: null, naturalHeight: null, sourcePageUrl: url }] }] };
}

describe('on-demand album collection', () => {
  it('follows only same-album pagination, deduplicates cycles, and publishes each page before fetching the next', async () => {
    const onPage = vi.fn(async (_page: CollectionPage) => {});
    const readPage = vi.fn(async () => {
      expect(onPage).toHaveBeenCalledTimes(1);
      return page(2, [`${base}&page=1`, base]);
    });
    const limited = await collectPages({ initial: page(1, [`${base}&page=2`, `?page=2&hl=ja#x`,
      '/album/another.html?hl=ja&page=2', 'https://other.example/?page=2']), signal: new AbortController().signal,
      onPage, readPage, onProgress: vi.fn() });
    expect(readPage).toHaveBeenCalledExactlyOnceWith(`${base}&page=2`);
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onPage.mock.calls[1]?.[0]).toMatchObject({ groups: [expect.objectContaining({
      variants: [expect.objectContaining({ sourcePageUrl: `${base}&page=2` })],
    })] });
    expect(limited).toBe(false);
  });
  it('stops scheduling further requests after cancellation and retains already collected pages', async () => {
    const controller = new AbortController();
    const readPage = vi.fn();
    const onPage = vi.fn(async () => { controller.abort(); });
    await expect(collectPages({ initial: page(1, [`${base}&page=2`]), signal: controller.signal,
      readPage, onPage, onProgress: vi.fn() })).rejects.toThrow();
    expect(readPage).not.toHaveBeenCalled();
    expect(onPage).toHaveBeenCalledOnce();
  });
  it('bounds crawling even when pagination keeps growing', async () => {
    let next = 2;
    const readPage = vi.fn(async () => { const n = next++; return page(n, [`${base}&page=${n + 1}`]); });
    expect(await collectPages({ initial: page(1, [`${base}&page=2`]), signal: new AbortController().signal,
      readPage, onPage: vi.fn(async () => {}), onProgress: vi.fn() })).toBe(true);
    expect(readPage).toHaveBeenCalledTimes(PAGE_COLLECTION_MAX_PAGES - 1);
  });
  it('does not publish a redirected login page as album images', async () => {
    const onPage = vi.fn(async () => {});
    await expect(collectPages({ initial: page(1, [`${base}&page=2`]), signal: new AbortController().signal,
      readPage: async () => ({ ...page(2), url: 'https://www.v2ph.com/login?hl=ja' }), onPage,
      onProgress: vi.fn() })).rejects.toThrow('別のページ');
    expect(onPage).toHaveBeenCalledOnce();
  });
});

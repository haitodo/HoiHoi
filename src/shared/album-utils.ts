/** Only visible pagination links for the same supported album may be followed. */
export function isSupportedAlbumUrl(value?: string): boolean {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && ['www.v2ph.com', 'v2ph.com'].includes(url.hostname) &&
      /^\/album\/[^/]+\/?$/.test(url.pathname) && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeAlbumPageUrl(value: string, albumUrl: string): string | null {
  if (!isSupportedAlbumUrl(albumUrl)) return null;
  try {
    const base = new URL(albumUrl);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password) return null;
    const page = url.searchParams.get('page') ?? '1';
    if (!/^[1-9]\d*$/.test(page) || Number(page) > 10_000 || url.searchParams.getAll('page').length > 1) return null;
    const expected = new URLSearchParams(base.search);
    expected.delete('page'); expected.sort();
    const actual = new URLSearchParams(url.search);
    actual.delete('page'); actual.sort();
    if (actual.toString() !== expected.toString()) return null;
    url.hash = '';
    if (page === '1') url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

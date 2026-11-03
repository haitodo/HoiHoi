/** Link evidence captured from the document; URLs alone do not establish pagination. */
export interface PaginationLink {
  href: string;
  label?: string;
  rel?: string;
  inPagination?: boolean;
}

export interface PaginationScope {
  origin: string;
  query: string;
  firstPageUrl?: string;
  route: { kind: 'query'; pathname: string; parameter: string; numeric: boolean; first: number }
    | { kind: 'path'; prefix: string; segment: string };
}

const NUMBER_PARAMETERS = new Set(['page', 'paged', 'pageno', 'pagenum', 'page_number', 'page_no', 'pg', 'offset', 'start']);
const CURSOR_PARAMETERS = new Set(['cursor', 'after', 'before']);
const PAGE_PATH = /^(.*\/)(page|paged)\/([1-9]\d*)\/?$/i;

/** Page numbers, unlike offsets or post IDs, can corroborate a title's pagination decoration. */
export function extractPageNumber(pageUrl?: string): number | null {
  if (!isCollectionPageUrl(pageUrl)) return null;
  const url = new URL(pageUrl!);
  const numbers = new Set<number>();
  for (const parameter of new Set(url.searchParams.keys())) {
    const key = parameter.toLowerCase();
    if (!NUMBER_PARAMETERS.has(key) || key === 'offset' || key === 'start') continue;
    const values = url.searchParams.getAll(parameter);
    if (values.length !== 1 || !validNumber(values[0]!, 1)) return null;
    numbers.add(Number(values[0]));
  }
  const pathPage = PAGE_PATH.exec(url.pathname)?.[3];
  if (pathPage) {
    if (!validNumber(pathPage, 1)) return null;
    numbers.add(Number(pathPage));
  }
  return numbers.size === 1 ? numbers.values().next().value! : null;
}

export function isCollectionPageUrl(value?: string): boolean {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function hasPaginationEvidence(link: PaginationLink): boolean {
  if (/(?:^|\s)(next|prev)(?:\s|$)/i.test(link.rel ?? '')) return true;
  const label = (link.label ?? '').replace(/\s+/g, ' ').trim();
  return Boolean(link.inPagination && (/^(?:\d+|page\s*\d+|ページ\s*\d+|\d+\s*ページ)$/i.test(label) ||
    /^(?:[‹›«»<>←→]+|次(?:へ|のページ|ページ)?|前(?:へ|のページ|ページ)?|最後|最初|next(?: page)?|prev(?:ious)?(?: page)?|first|last)[\s‹›«»<>←→]*$/i.test(label)));
}

function sortedQuery(url: URL, omitted?: string): string {
  const params = new URLSearchParams(url.search);
  if (omitted) params.delete(omitted);
  params.sort();
  return params.toString();
}

function validNumber(value: string, first: number): boolean {
  return /^\d+$/.test(value) && Number(value) >= first && Number(value) <= 1_000_000_000;
}

function inferScope(base: URL, target: URL): PaginationScope | null {
  if (base.origin !== target.origin || target.username || target.password) return null;
  if (base.pathname === target.pathname) {
    const keys = new Set([...base.searchParams.keys(), ...target.searchParams.keys()]);
    for (const parameter of keys) {
      const key = parameter.toLowerCase();
      const numeric = NUMBER_PARAMETERS.has(key);
      if (!numeric && !CURSOR_PARAMETERS.has(key)) continue;
      if (base.searchParams.getAll(parameter).length > 1 || target.searchParams.getAll(parameter).length > 1) continue;
      const first = key === 'offset' || key === 'start' ? 0 : 1;
      const before = base.searchParams.get(parameter);
      const after = target.searchParams.get(parameter);
      if (before === after || (!before && !after) || sortedQuery(base, parameter) !== sortedQuery(target, parameter)) continue;
      if (numeric && ((before !== null && !validNumber(before, first)) || (after !== null && !validNumber(after, first)))) continue;
      if (!numeric && ((before?.length ?? 0) > 512 || (after?.length ?? 0) > 512 || before === '' || after === '')) continue;
      const scope: PaginationScope = { origin: base.origin, query: sortedQuery(base, parameter),
        route: { kind: 'query', pathname: base.pathname, parameter, numeric, first } };
      if (!base.searchParams.has(parameter)) {
        const initial = new URL(base); initial.hash = ''; initial.searchParams.sort();
        scope.firstPageUrl = initial.href;
      }
      return scope;
    }
  }
  if (sortedQuery(base) !== sortedQuery(target)) return null;
  const page = PAGE_PATH.exec(target.pathname) ?? PAGE_PATH.exec(base.pathname);
  if (!page) return null;
  const prefix = page[1]!;
  const segment = page[2]!;
  const scope: PaginationScope = { origin: base.origin, query: sortedQuery(base), route: { kind: 'path', prefix, segment } };
  const root = prefix.replace(/\/$/, '') || '/';
  if (base.pathname === prefix || base.pathname === root) {
    const initial = new URL(base); initial.hash = ''; initial.searchParams.sort();
    scope.firstPageUrl = initial.href;
  }
  return normalizePaginationUrl(base.href, scope) && normalizePaginationUrl(target.href, scope) ? scope : null;
}

/** The scope stays fixed for the entire run, even if later documents link to another collection. */
export function normalizePaginationUrl(value: string, scope: PaginationScope): string | null {
  try {
    const url = new URL(value);
    if (!isCollectionPageUrl(url.href) || url.origin !== scope.origin) return null;
    const route = scope.route;
    if (route.kind === 'query') {
      if (url.pathname !== route.pathname || sortedQuery(url, route.parameter) !== scope.query ||
        url.searchParams.getAll(route.parameter).length > 1) return null;
      const number = url.searchParams.get(route.parameter);
      if (number !== null && (route.numeric ? !validNumber(number, route.first) : !number || number.length > 512)) return null;
      if (route.numeric && number !== null && Number(number) === route.first && scope.firstPageUrl) return scope.firstPageUrl;
    } else {
      if (sortedQuery(url) !== scope.query) return null;
      const page = PAGE_PATH.exec(url.pathname);
      const root = route.prefix.replace(/\/$/, '') || '/';
      if (url.pathname !== route.prefix && url.pathname !== root &&
        (!page || page[1] !== route.prefix || page[2]!.toLowerCase() !== route.segment.toLowerCase())) return null;
      if (page && Number(page[3]) > 1_000_000_000) return null;
      if (page?.[3] === '1' && scope.firstPageUrl) return scope.firstPageUrl;
    }
    url.hash = ''; url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

export function detectPaginationScope(pageUrl: string, links: PaginationLink[]): PaginationScope {
  if (!isCollectionPageUrl(pageUrl)) throw new Error('通常のWebページで実行してください');
  const base = new URL(pageUrl);
  const scopes = new Map<string, PaginationScope>();
  for (const link of links) {
    if (!hasPaginationEvidence(link)) continue;
    try {
      const target = new URL(link.href, base);
      const scope = inferScope(base, target);
      if (scope && normalizePaginationUrl(target.href, scope) !== normalizePaginationUrl(base.href, scope)) {
        scopes.set(JSON.stringify(scope), scope);
      }
    } catch { /* A malformed link does not establish a page sequence. */ }
  }
  if (scopes.size > 1) throw new Error('複数のページ送りがあり、収集範囲を判定できませんでした');
  const scope = scopes.values().next().value;
  if (!scope) throw new Error('ページ送りを検出できませんでした。リンクのない追加読み込みには自動スクロールをお試しください');
  return scope;
}

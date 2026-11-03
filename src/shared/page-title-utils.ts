import { extractPageNumber } from './pagination-utils';

function isPageDecoration(value: string, expectedPage: number): boolean {
  const token = value.normalize('NFKC').trim();
  const match = /^(?:page\s*(\d+)(?:\s*(?:of|\/)\s*\d+)?|(?:第\s*)?(\d+)\s*(?:ページ(?:目)?|[页頁])|ページ\s*(\d+)(?:\s*\/\s*\d+)?)$/i.exec(token);
  return Boolean(match && Number(match[1] ?? match[2] ?? match[3]) === expectedPage);
}

/** Normalize only automatic folder titles; retain the original title for display and explicit folder names. */
export function normalizePageTitleForFolder(title: string, pageUrl?: string): string {
  const page = extractPageNumber(pageUrl);
  if (page === null) return title;
  // Preserve the separators adjacent to surviving title segments (e.g. the site's suffix).
  const segments = title.split(/(\s+[-‐‑‒–—−·•»›]\s+|\s*[|｜]\s*)/);
  const kept: Array<{ title: string; separator: string }> = [];
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i]!.replace(/\([^()]*\)|（[^（）]*）|\[[^\[\]]*\]|［[^［］]*］|【[^【】]*】/g,
      (decoration) => isPageDecoration(decoration.slice(1, -1), page) ? '' : decoration);
    if (!segment.trim() || isPageDecoration(segment, page)) continue;
    kept.push({ title: segment.trim(), separator: segments[i - 1] ?? '' });
  }
  const normalized = kept.map((entry, index) => `${index === 0 ? '' : entry.separator}${entry.title}`).join('');
  return normalized.replace(/\s+/g, ' ').trim() || title;
}

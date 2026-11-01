/**
 * Dynamic `declarativeNetRequest` session rule manager for extension-initiated media requests.
 *
 * Why this exists:
 * - Video CDNs (such as TokyoMotion `www*.tokyomotion.net`, BunnyCDN, etc.) return `403 Forbidden`
 *   when `Referer` is absent or set to `chrome-extension://...`.
 * - All rules managed here strictly specify `initiatorDomains: [chrome.runtime.id]`, which guarantees
 *   regular webpage traffic in user tabs is NEVER modified.
 * - Rules live strictly in memory (`updateSessionRules`) and are cleaned up when the Side Panel
 *   closes and no downloads are active.
 */

const ACTIVE_TAB_RULE_ID = 1;
const FALLBACK_DOWNLOAD_RULE_ID = 2;
const FIRST_SCOPED_DOWNLOAD_RULE_ID = 1000;

const COMMON_TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'ed.jp',
  'lg.jp',
  'gr.jp',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.kr',
  'com.tw',
  'org.tw',
  'com.cn',
  'net.cn',
  'com.hk',
  'com.sg',
  'com.br',
  'com.mx',
]);

export function parseHttpRefererAndOrigin(
  pageUrl?: string,
): { referer: string; origin: string } | null {
  if (!pageUrl) return null;
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return {
      referer: parsed.href,
      origin: parsed.origin,
    };
  } catch {
    return null;
  }
}

export function extractRequestDomainScope(urlStr?: string): string | null {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
      return host || null;
    }
    const labels = host.split('.').filter(Boolean);
    if (labels.length <= 2) {
      return host;
    }
    const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
    if (COMMON_TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo) && labels.length >= 3) {
      return `${labels[labels.length - 3]}.${lastTwo}`;
    }
    return lastTwo;
  } catch {
    return null;
  }
}

interface ScopedDownloadRuleEntry {
  ruleId: number;
  referer: string;
  origin: string;
  requestDomains: string[];
}

export class RefererRuleManager {
  private nextDownloadRuleId = FIRST_SCOPED_DOWNLOAD_RULE_ID;
  private activeTabPageUrl: string | undefined;
  private readonly activeDownloadRules = new Map<string, ScopedDownloadRuleEntry>();
  private updateChain: Promise<void> = Promise.resolve();

  private isDnrAvailable(): boolean {
    return Boolean(
      typeof chrome !== 'undefined' &&
        chrome.runtime?.id &&
        chrome.declarativeNetRequest &&
        typeof chrome.declarativeNetRequest.updateSessionRules === 'function',
    );
  }

  private enqueueUpdate(fn: () => Promise<void>): Promise<void> {
    const next = this.updateChain.then(fn, fn).catch((err) => {
      console.warn('[WIC RefererRules] Failed to update DNR session rules:', err);
    });
    this.updateChain = next;
    return next;
  }

  private buildModifyHeadersRule(options: {
    id: number;
    priority: number;
    referer: string;
    origin: string;
    requestDomains?: string[];
  }): chrome.declarativeNetRequest.Rule {
    const extId = chrome.runtime.id;
    const actionType = (chrome.declarativeNetRequest.RuleActionType?.MODIFY_HEADERS ??
      'modifyHeaders') as chrome.declarativeNetRequest.RuleActionType;
    const setOp = (chrome.declarativeNetRequest.HeaderOperation?.SET ??
      'set') as chrome.declarativeNetRequest.HeaderOperation;
    const resourceTypes = [
      chrome.declarativeNetRequest.ResourceType?.XMLHTTPREQUEST ?? 'xmlhttprequest',
      chrome.declarativeNetRequest.ResourceType?.MEDIA ?? 'media',
      chrome.declarativeNetRequest.ResourceType?.IMAGE ?? 'image',
      chrome.declarativeNetRequest.ResourceType?.OTHER ?? 'other',
    ] as chrome.declarativeNetRequest.ResourceType[];

    const condition: chrome.declarativeNetRequest.RuleCondition = {
      initiatorDomains: [extId],
      resourceTypes,
    };
    if (options.requestDomains && options.requestDomains.length > 0) {
      condition.requestDomains = options.requestDomains;
    }

    return {
      id: options.id,
      priority: options.priority,
      action: {
        type: actionType,
        requestHeaders: [
          { header: 'Referer', operation: setOp, value: options.referer },
          { header: 'Origin', operation: setOp, value: options.origin },
        ],
      },
      condition,
    };
  }

  /**
   * Updates the baseline Side Panel rule (ID 1) for the currently viewed tab so `<video>` previews,
   * hotlink-protected poster thumbnails, and HLS fetches authenticate with the page's Referer.
   */
  public setActiveTabContext(pageUrl?: string): Promise<void> {
    this.activeTabPageUrl = pageUrl;
    if (!this.isDnrAvailable()) return Promise.resolve();

    const parsed = parseHttpRefererAndOrigin(pageUrl);
    return this.enqueueUpdate(async () => {
      if (!parsed) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [ACTIVE_TAB_RULE_ID],
        });
        return;
      }

      const rule = this.buildModifyHeadersRule({
        id: ACTIVE_TAB_RULE_ID,
        priority: 1,
        referer: parsed.referer,
        origin: parsed.origin,
      });
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ACTIVE_TAB_RULE_ID],
        addRules: [rule],
      });
    });
  }

  /**
   * Installs high-priority Referer/Origin rules for an active download so tab switches or
   * cross-subdomain/third-party CDN redirects preserve the originating page's Referer.
   */
  public acquireDownloadRule(
    key: string,
    pageUrl?: string,
    targetUrl?: string,
  ): Promise<void> {
    if (!this.isDnrAvailable()) return Promise.resolve();

    const parsed = parseHttpRefererAndOrigin(pageUrl);
    if (!parsed) return Promise.resolve();

    const existing = this.activeDownloadRules.get(key);
    const ruleId = existing ? existing.ruleId : this.nextDownloadRuleId++;
    if (this.nextDownloadRuleId > 900_000) {
      this.nextDownloadRuleId = FIRST_SCOPED_DOWNLOAD_RULE_ID;
    }

    const domainSet = new Set<string>();
    const pageDomain = extractRequestDomainScope(pageUrl);
    const targetDomain = extractRequestDomainScope(targetUrl);
    if (pageDomain) domainSet.add(pageDomain);
    if (targetDomain) domainSet.add(targetDomain);

    const entry: ScopedDownloadRuleEntry = {
      ruleId,
      referer: parsed.referer,
      origin: parsed.origin,
      requestDomains: Array.from(domainSet),
    };
    this.activeDownloadRules.set(key, entry);

    return this.enqueueUpdate(async () => {
      const addRules: chrome.declarativeNetRequest.Rule[] = [];
      const removeRuleIds: number[] = [ruleId, FALLBACK_DOWNLOAD_RULE_ID];

      if (entry.requestDomains.length > 0) {
        addRules.push(
          this.buildModifyHeadersRule({
            id: ruleId,
            priority: 50,
            referer: entry.referer,
            origin: entry.origin,
            requestDomains: entry.requestDomains,
          }),
        );
      }

      // Fallback rule (priority 10, all domains for extension initiator) covers unexpected
      // third-party CDN redirect hops whose domain was unknown prior to the 301/302 response.
      addRules.push(
        this.buildModifyHeadersRule({
          id: FALLBACK_DOWNLOAD_RULE_ID,
          priority: 10,
          referer: entry.referer,
          origin: entry.origin,
        }),
      );

      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules,
      });
    });
  }

  /**
   * Releases a download's scoped Referer rule once streaming/downloading finishes.
   */
  public releaseDownloadRule(key: string): Promise<void> {
    const existing = this.activeDownloadRules.get(key);
    if (!existing) return Promise.resolve();
    this.activeDownloadRules.delete(key);

    if (!this.isDnrAvailable()) return Promise.resolve();

    // If another download is still active, keep FALLBACK_DOWNLOAD_RULE_ID pointed at it
    const remainingEntries = Array.from(this.activeDownloadRules.values());
    const latestRemaining = remainingEntries[remainingEntries.length - 1];

    return this.enqueueUpdate(async () => {
      const removeRuleIds = [existing.ruleId, FALLBACK_DOWNLOAD_RULE_ID];
      const addRules: chrome.declarativeNetRequest.Rule[] = [];

      if (latestRemaining) {
        addRules.push(
          this.buildModifyHeadersRule({
            id: FALLBACK_DOWNLOAD_RULE_ID,
            priority: 10,
            referer: latestRemaining.referer,
            origin: latestRemaining.origin,
          }),
        );
      }

      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules: addRules.length > 0 ? addRules : undefined,
      });
    });
  }

  /**
   * Removes idle session rules when the Side Panel closes and no downloads are active.
   */
  public clearIdleRulesIfPossible(): Promise<void> {
    this.activeTabPageUrl = undefined;
    if (!this.isDnrAvailable()) return Promise.resolve();

    return this.enqueueUpdate(async () => {
      const removeRuleIds = [ACTIVE_TAB_RULE_ID];
      if (this.activeDownloadRules.size === 0) {
        removeRuleIds.push(FALLBACK_DOWNLOAD_RULE_ID);
      }
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
      });
    });
  }

  public getActiveTabPageUrl(): string | undefined {
    return this.activeTabPageUrl;
  }
}

export const refererRuleManager = new RefererRuleManager();

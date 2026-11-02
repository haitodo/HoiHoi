import {
  inferVideoFormat,
  isKnownAdOrTrackerVideoUrl,
  isLikelyVideoUrl,
  isSegmentChunkNoiseUrl,
  parseContentRangeTotalBytes,
  stripByteRangeQueryParam,
} from '@shared/video-utils';
import { sessionStore, type SessionStore } from './session-store';

const MAX_REDIRECT_ENTRIES = 500;
const MAX_REDIRECT_HOPS = 8;
const MIN_DIRECT_VIDEO_BYTES = 10 * 1024; // 10 KB threshold to ignore tiny UI micro-animations

function getHeaderValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  targetNameLower: string,
): string | undefined {
  if (!headers) return undefined;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h && h.name.toLowerCase() === targetNameLower && typeof h.value === 'string') {
      return h.value;
    }
  }
  return undefined;
}

/**
 * Event-driven HTTP response header sniffer for active Side Panel sessions.
 *
 * Key properties:
 * 1. Registers one browser-level tab filter per visible, scanned panel target and removes
 *    listeners when that target is no longer used. No listener covers unrelated tabs.
 * 2. Tracks `301`/`302`/`307` redirect chains (`onBeforeRedirect`) so opaque player endpoints
 *    (e.g. `tokyomotion.net/vsrc/sd/...` -> `www47.tokyomotion.net/.../1234567.mp4`) merge cleanly
 *    into the existing `<video>` card instead of creating duplicate entries.
 * 3. Parses HTTP/2 lowercase headers and `Content-Range: bytes X-Y/TOTAL` accurately.
 */
export class NetworkVideoSniffer {
  private readonly sessionStore: SessionStore;
  private readonly listeners = new Map<number, {
    redirect: (details: chrome.webRequest.WebRedirectionResponseDetails) => void;
    headers: (details: chrome.webRequest.WebResponseHeadersDetails) => void;
  }>();
  private readonly redirectSources = new Map<number, Map<string, string>>();

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  private readonly onBeforeRedirect = (
    details: chrome.webRequest.WebRedirectionResponseDetails,
  ): void => {
    if (!this.listeners.has(details.tabId)) return;
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;
    if (!details.url || !details.redirectUrl || details.url === details.redirectUrl) return;

    let redirects = this.redirectSources.get(details.tabId);
    if (!redirects) this.redirectSources.set(details.tabId, redirects = new Map());
    if (redirects.size >= MAX_REDIRECT_ENTRIES) {
      const oldestKey = redirects.keys().next().value;
      if (oldestKey !== undefined) {
        redirects.delete(oldestKey);
      }
    }
    redirects.set(details.redirectUrl, details.url);
  };

  private readonly onHeadersReceived = (
    details: chrome.webRequest.WebResponseHeadersDetails,
  ): void => {
    if (!this.listeners.has(details.tabId)) return;
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;
    if (details.statusCode >= 400) return;

    const session = this.sessionStore.getSession(details.tabId);
    if (
      !session ||
      session.scanStatus === 'unscanned' ||
      session.scanStatus === 'restricted' ||
      session.scanStatus === 'stale'
    ) {
      return;
    }

    const rawContentType = getHeaderValue(details.responseHeaders, 'content-type');
    const cleanMime = rawContentType?.split(';')[0]?.trim().toLowerCase() ?? '';

    const isManifestMime =
      cleanMime === 'application/vnd.apple.mpegurl' ||
      cleanMime === 'application/x-mpegurl' ||
      cleanMime === 'audio/mpegurl' ||
      cleanMime === 'application/dash+xml';

    // Quickly skip HTML, scripts, stylesheets, images, and standalone audio
    if (
      cleanMime &&
      !isManifestMime &&
      (cleanMime.startsWith('text/html') ||
        cleanMime.startsWith('text/css') ||
        cleanMime.startsWith('text/javascript') ||
        cleanMime.startsWith('application/javascript') ||
        cleanMime.startsWith('application/json') ||
        cleanMime.startsWith('image/') ||
        cleanMime.startsWith('font/') ||
        cleanMime.startsWith('audio/'))
    ) {
      return;
    }

    const normalizedUrl = cleanMime.startsWith('video/')
      ? stripByteRangeQueryParam(details.url)
      : details.url;

    if (
      isSegmentChunkNoiseUrl(normalizedUrl) ||
      isKnownAdOrTrackerVideoUrl(normalizedUrl)
    ) {
      return;
    }

    const format = inferVideoFormat(normalizedUrl, cleanMime || undefined);
    const isVideoCandidate =
      format !== 'unknown' ||
      cleanMime.startsWith('video/') ||
      isLikelyVideoUrl(normalizedUrl, cleanMime || undefined);

    if (!isVideoCandidate) {
      return;
    }

    // Extract accurate total file size from Content-Range (206) or Content-Length (200)
    const contentRange = getHeaderValue(details.responseHeaders, 'content-range');
    let fileSizeBytes = parseContentRangeTotalBytes(contentRange);
    if (fileSizeBytes === null && details.statusCode === 200) {
      const contentLength = getHeaderValue(details.responseHeaders, 'content-length');
      if (contentLength) {
        const parsedLen = Number(contentLength);
        if (Number.isFinite(parsedLen) && parsedLen > 0) {
          fileSizeBytes = parsedLen;
        }
      }
    }

    if (
      fileSizeBytes !== null &&
      fileSizeBytes > 0 &&
      fileSizeBytes < MIN_DIRECT_VIDEO_BYTES &&
      format !== 'hls' &&
      format !== 'dash'
    ) {
      return;
    }

    // Reconstruct any 301/302 redirect chain leading to details.url
    const redirectChainUrls: string[] = [];
    let cursor: string = details.url;
    const visited = new Set<string>([details.url]);
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      const prev: string | undefined = this.redirectSources.get(details.tabId)?.get(cursor);
      if (!prev || visited.has(prev)) break;
      visited.add(prev);
      redirectChainUrls.push(prev);
      cursor = prev;
    }

    this.sessionStore.mergeNetworkDetectedVideo(details.tabId, {
      url: normalizedUrl,
      redirectChainUrls: redirectChainUrls.length > 0 ? redirectChainUrls : undefined,
      mimeHint: cleanMime || undefined,
      fileSizeBytes,
    });
  };

  public setWatchedTabs(tabIds: Iterable<number>): void {
    const desired = new Set(tabIds);
    for (const [tabId, callbacks] of this.listeners) {
      if (desired.has(tabId)) continue;
      chrome.webRequest.onBeforeRedirect.removeListener(callbacks.redirect);
      chrome.webRequest.onHeadersReceived.removeListener(callbacks.headers);
      this.listeners.delete(tabId);
      this.redirectSources.delete(tabId);
    }
    if (
      typeof chrome === 'undefined' ||
      !chrome.webRequest?.onHeadersReceived ||
      !chrome.webRequest?.onBeforeRedirect
    ) {
      return;
    }

    for (const tabId of desired) {
      if (!Number.isInteger(tabId) || tabId < 0 || this.listeners.has(tabId)) continue;
      const callbacks = {
        redirect: (details: chrome.webRequest.WebRedirectionResponseDetails) => this.onBeforeRedirect(details),
        headers: (details: chrome.webRequest.WebResponseHeadersDetails) => this.onHeadersReceived(details),
      };
      try {
        const filter: chrome.webRequest.RequestFilter = {
          tabId,
          urls: ['http://*/*', 'https://*/*'],
          types: ['media', 'xmlhttprequest', 'other'],
        };
        chrome.webRequest.onBeforeRedirect.addListener(callbacks.redirect, filter);
        chrome.webRequest.onHeadersReceived.addListener(callbacks.headers, filter, ['responseHeaders']);
        this.listeners.set(tabId, callbacks);
      } catch (err) {
        chrome.webRequest.onBeforeRedirect.removeListener(callbacks.redirect);
        chrome.webRequest.onHeadersReceived.removeListener(callbacks.headers);
        console.warn('[WIC NetworkSniffer] Could not attach webRequest listeners:', err);
      }
    }
  }

  public stopSniffing(): void {
    this.setWatchedTabs([]);
  }

  public isSniffing(): boolean {
    return this.listeners.size > 0;
  }
}

export const networkSniffer = new NetworkVideoSniffer(sessionStore);

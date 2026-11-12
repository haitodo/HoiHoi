import {
  MUTATION_DEBOUNCE_MS,
  OBSERVED_MUTATION_ATTRIBUTES,
  SCAN_BATCH_INTERVAL_MS,
  SCAN_BATCH_MAX_SIZE,
  SCAN_CHUNK_BUDGET_MS,
  MAX_PENDING_SCAN_NODES,
  MAX_OCCURRENCE_KEYS_PER_TAB,
  MAX_VARIANTS_PER_ITEM,
  INLINE_DATA_URL_SESSION_MAX_CHARS,
} from '@shared/constants';
import { getXasiatAlbumImageSelector } from '@shared/album-utils';
import type { ContentToBackgroundMessage } from '@shared/messages';
import type { RawCandidateGroup, RawVideoCandidateGroup } from '@shared/types';
import {
  extractFromCssBackground,
  extractFromImageElement,
  extractFromLazyAttributes,
  extractFromSvgImage,
  type ExtractorContext,
} from './dom-extractor';
import { createNetworkMediaObserver } from './network-media-observer';
import {
  iterateEmbeddedScriptAndConfigVideos,
  extractFromVideoElement,
  extractFromVideoLinkOrLazyElement,
  extractPageFallbackVideoMeta,
  iteratePageMetadataVideos,
  tryCaptureReadyVideoFrame,
  type PageFallbackVideoMeta,
} from './video-extractor';
import { isKnownAdOrTrackerVideoUrl } from '@shared/video-utils';

export interface ChunkRunnerController {
  startOrRescan(scanEpoch: number, replay?: boolean): void;
  destroy(releaseCache?: boolean): void;
}

// Highly selective query to avoid running expensive getComputedStyle on thousands of plain elements
const MEDIA_TARGET_SELECTOR = [
  'img',
  'picture',
  'video',
  'source',
  'a[href]',
  'svg image',
  '[data-src]',
  '[data-original]',
  '[data-lazy-src]',
  '[data-lazy]',
  '[data-url]',
  '[data-hi-res-src]',
  '[data-srcset]',
  '[data-video-src]',
  '[data-video]',
  '[data-video-url]',
  '[data-mp4]',
  '[data-webm]',
  '[data-stream]',
  '[data-hls]',
  '[style*="background"]',
  '[style*="url("]',
].join(', ');

/**
 * Checks whether the Chrome extension context is still alive.
 * When the extension is reloaded or updated, the old context is invalidated.
 */
function isExtensionContextValid(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/**
 * Checks whether an error is caused by Chrome extension context invalidation.
 */
function isContextInvalidatedError(err: unknown): boolean {
  if (!err) return false;
  const msg = String(err);
  return msg.includes('Extension context invalidated') || msg.includes('context invalidated');
}

/**
 * Safely dispatches a message to the Background Service Worker without throwing unhandled exceptions
 * if the extension has been reloaded or context is invalidated.
 */
function safeSendMessage(
  message: ContentToBackgroundMessage,
  onInvalidated?: () => void,
): Promise<unknown> | undefined {
  if (!isExtensionContextValid()) {
    onInvalidated?.();
    return;
  }

  try {
    const promise = chrome.runtime.sendMessage(message);
    if (promise && typeof promise.catch === 'function') {
      return promise.catch((err: unknown) => {
        if (isContextInvalidatedError(err)) {
          onInvalidated?.();
        } else {
          console.warn('[WIC Content] Failed to send message:', err);
        }
      });
    }
  } catch (err: unknown) {
    if (isContextInvalidatedError(err)) {
      onInvalidated?.();
    } else {
      console.warn('[WIC Content] Synchronous sendMessage error:', err);
    }
  }
}

export function createChunkRunner(options: {
  largeDataUrlStore: Map<string, string>;
}): ChunkRunnerController {
  const { largeDataUrlStore } = options;

  let isDestroyed = false;
  let currentScanEpoch = 0;
  let albumImageSelector: string | undefined;
  let elementCounter = 0;
  let domOrderCounter = 0;
  const elementIdMap = new WeakMap<Element, number>();

  const extractorContext: ExtractorContext = {
    get baseUri() {
      return document.baseURI || window.location.href;
    },
    elementIdMap,
    nextElementId: () => ++elementCounter,
    largeDataUrlStore,
    domOrderCounter: () => ++domOrderCounter,
  };

  const networkObserver = createNetworkMediaObserver(extractorContext);

  // Unified batch buffers for image & video candidate groups
  let batchBuffer: RawCandidateGroup[] = [];
  let videoBatchBuffer: RawVideoCandidateGroup[] = [];
  let batchFlushTimer: number | null = null;
  let totalCandidatesSent = 0;
  let isObserving = false;
  let reportedComplete = false;
  let cacheLimitReached = false;
  const lastSentGroups = new Map<string, string>();
  let signatureChars = 0;
  let inFlightBatches = 0;
  let waitingForBatch = false;
  let runGeneration = 0;

  function changedGroup(group: RawCandidateGroup | RawVideoCandidateGroup): boolean {
    const signature = JSON.stringify({ ...group, domOrder: 0 });
    if (lastSentGroups.get(group.occurrenceKey) === signature) return false;
    signatureChars -= lastSentGroups.get(group.occurrenceKey)?.length ?? 0;
    lastSentGroups.delete(group.occurrenceKey);
    if (signature.length > 1_000_000) return true;
    while (lastSentGroups.size >= MAX_OCCURRENCE_KEYS_PER_TAB || signatureChars + signature.length > 1_000_000) {
      const key = lastSentGroups.keys().next().value;
      if (key === undefined) break;
      signatureChars -= lastSentGroups.get(key)!.length;
      lastSentGroups.delete(key);
    }
    lastSentGroups.set(group.occurrenceKey, signature);
    signatureChars += signature.length;
    return true;
  }

  function stopObserving() {
    if (!isObserving) return;
    try {
      observer.disconnect();
    } catch {}
    try {
      window.removeEventListener('load', onCaptureLoad, true);
      window.removeEventListener('loadedmetadata', onCaptureVideoMetadata, true);
      window.removeEventListener('encrypted', onCaptureVideoEncrypted, true);
    } catch {}
    networkObserver.stopObserving();
    isObserving = false;
  }

  function ensureObserving() {
    if (isObserving || isDestroyed || !isExtensionContextValid()) return;
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: OBSERVED_MUTATION_ATTRIBUTES as string[],
      });
      window.addEventListener('load', onCaptureLoad, true);
      window.addEventListener('loadedmetadata', onCaptureVideoMetadata, true);
      window.addEventListener('encrypted', onCaptureVideoEncrypted, true);
      networkObserver.startObserving((groups) => {
        for (const g of groups) {
          enqueueVideoGroup(g);
        }
      });
      isObserving = true;
    } catch (err) {
      console.warn('[WIC Content] Failed to start DOM observer:', err);
    }
  }

  function destroy(releaseCache = false) {
    if (releaseCache) {
      lastSentGroups.clear();
      signatureChars = 0;
      networkObserver.resetSeenUrls();
    }
    if (isDestroyed) return;
    isDestroyed = true;
    runGeneration++;
    inFlightBatches = 0;
    waitingForBatch = false;

    stopObserving();

    if (sliceTimer !== null) {
      clearTimeout(sliceTimer);
      sliceTimer = null;
    }
    if (batchFlushTimer !== null) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }
    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = null;
    }

    pendingElements = [];
    discoveryTasks = [];
    discoveryIndex = 0;
    isSliceRunning = false;
    batchBuffer = [];
    videoBatchBuffer = [];
    mutatedElements.clear();
  }

  function flushBatch() {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    if (batchFlushTimer !== null) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }

    if (batchBuffer.length === 0 && videoBatchBuffer.length === 0) return;
    if (inFlightBatches >= 2) return;

    const groupsToSend = batchBuffer;
    const videoGroupsToSend = videoBatchBuffer;
    batchBuffer = [];
    videoBatchBuffer = [];
    totalCandidatesSent += groupsToSend.length + videoGroupsToSend.length;

    const message: ContentToBackgroundMessage = {
      channel: 'WIC_CONTENT_TO_BG',
      type: 'CONTENT_SCAN_BATCH',
      scanEpoch: currentScanEpoch,
      pageUrl: window.location.href,
      pageTitle: document.title || undefined,
      groups: groupsToSend,
      videoGroups: videoGroupsToSend.length > 0 ? videoGroupsToSend : undefined,
    };

    const generation = runGeneration;
    inFlightBatches++;
    void Promise.resolve(safeSendMessage(message, destroy)).then((response) => {
      if (!(response as { ok?: boolean } | undefined)?.ok && generation === runGeneration) {
        for (const group of [...groupsToSend, ...videoGroupsToSend]) {
          signatureChars -= lastSentGroups.get(group.occurrenceKey)?.length ?? 0;
          lastSentGroups.delete(group.occurrenceKey);
        }
      }
    }).finally(() => {
      if (generation !== runGeneration || isDestroyed) return;
      inFlightBatches--;
      if (waitingForBatch && sliceTimer === null) {
        waitingForBatch = false;
        sliceTimer = window.setTimeout(runNextSlice, 0);
      } else if (batchBuffer.length || videoBatchBuffer.length) scheduleFlushCheck();
    });
  }

  function scheduleFlushCheck() {
    const bufferedTotal = batchBuffer.length + videoBatchBuffer.length;
    if (totalCandidatesSent === 0 && bufferedTotal >= 5) {
      flushBatch();
    } else if (bufferedTotal >= SCAN_BATCH_MAX_SIZE) {
      flushBatch();
    } else if (batchFlushTimer === null) {
      batchFlushTimer = window.setTimeout(flushBatch, SCAN_BATCH_INTERVAL_MS);
    }
  }

  function enqueueGroup(group: RawCandidateGroup) {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }
    group = { ...group, variants: group.variants.slice(0, MAX_VARIANTS_PER_ITEM) };
    if (group.primaryUrl.startsWith('data:') && group.primaryUrl.length > INLINE_DATA_URL_SESSION_MAX_CHARS) {
      const replacement = group.variants.find((variant) => variant.largeDataRefId)?.url;
      if (!replacement) return;
      group = { ...group, primaryUrl: replacement,
        occurrenceKey: group.occurrenceKey.replace(group.primaryUrl, replacement) };
    }
    if (!changedGroup(group)) return;
    batchBuffer.push(group);
    scheduleFlushCheck();
  }

  function enqueueVideoGroup(group: RawVideoCandidateGroup) {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }
    group = { ...group, variants: group.variants.slice(0, MAX_VARIANTS_PER_ITEM),
      posterUrl: group.posterUrl && group.posterUrl.length <= INLINE_DATA_URL_SESSION_MAX_CHARS ? group.posterUrl : undefined };
    if (group.primaryUrl.startsWith('data:') && group.primaryUrl.length > INLINE_DATA_URL_SESSION_MAX_CHARS) {
      const replacement = group.variants.find((variant) => variant.largeDataRefId)?.url;
      if (!replacement) return;
      group = { ...group, primaryUrl: replacement,
        occurrenceKey: group.occurrenceKey.replace(group.primaryUrl, replacement) };
    }
    if (!changedGroup(group)) return;
    videoBatchBuffer.push(group);
    scheduleFlushCheck();
  }

  // Active queue of elements pending inspection
  let pendingElements: Element[] = [];
  let pendingIndex = 0; // O(1) pointer instead of O(N) array.shift()
  let isSliceRunning = false;
  let sliceTimer: number | null = null;
  let cachedPageFallbackMeta: PageFallbackVideoMeta | undefined;
  let discoveryTasks: Array<Iterator<Element | undefined>> = [];
  let discoveryIndex = 0;

  // TreeWalker advances one node at a time; no whole-document snapshot or subtree query
  // runs inside a MutationObserver callback. Open shadow roots share the same time budget.
  function* discover(root: ParentNode, depth = 0): Generator<Element> {
    if (root instanceof Element) yield root;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      yield el;
      if (el.shadowRoot && depth < 4) yield* discover(el.shadowRoot, depth + 1);
    }
    if (root instanceof Element && root.shadowRoot && depth < 4) {
      yield* discover(root.shadowRoot, depth + 1);
    }
  }

  function* discoverMetadata(): Generator<undefined> {
    cachedPageFallbackMeta = extractPageFallbackVideoMeta(document, extractorContext.baseUri);
    yield undefined;
    for (const group of iteratePageMetadataVideos(document, extractorContext)) {
      if (group) enqueueVideoGroup(group);
      yield undefined;
    }
    for (const group of iterateEmbeddedScriptAndConfigVideos(document, extractorContext, cachedPageFallbackMeta)) {
      if (group) enqueueVideoGroup(group);
      yield undefined;
    }
    for (const group of networkObserver.scanBufferedEntries()) {
      enqueueVideoGroup(group);
      yield undefined;
    }
  }

  function getSingleVideoPageFallback(): PageFallbackVideoMeta | undefined {
    if (!cachedPageFallbackMeta) return undefined;
    const videos = document.getElementsByTagName('video');
    return videos.length === 1 ? cachedPageFallbackMeta : undefined;
  }

  function processElement(el: Element) {
    if (el instanceof HTMLImageElement) {
      if (albumImageSelector && !el.matches(albumImageSelector)) return;
      const group = extractFromImageElement(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    if (el instanceof HTMLVideoElement) {
      const { videoGroup, posterImageGroup } = extractFromVideoElement(
        el,
        extractorContext,
        el.getRootNode() instanceof ShadowRoot,
        getSingleVideoPageFallback(),
      );
      if (videoGroup) enqueueVideoGroup(videoGroup);
      if (posterImageGroup && !albumImageSelector) enqueueGroup(posterImageGroup);
      return;
    }

    if (el instanceof HTMLSourceElement) {
      if (el.parentElement instanceof HTMLVideoElement) {
        const { videoGroup, posterImageGroup } = extractFromVideoElement(
          el.parentElement,
          extractorContext,
          el.parentElement.getRootNode() instanceof ShadowRoot,
          getSingleVideoPageFallback(),
        );
        if (videoGroup) enqueueVideoGroup(videoGroup);
        if (posterImageGroup && !albumImageSelector) enqueueGroup(posterImageGroup);
      }
      return;
    }

    if (el instanceof SVGImageElement) {
      if (albumImageSelector) return;
      const group = extractFromSvgImage(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    // Video links (<a href="*.mp4">) & explicit lazy video attributes
    const videoLinkGroup = extractFromVideoLinkOrLazyElement(el, extractorContext);
    if (videoLinkGroup) {
      enqueueVideoGroup(videoLinkGroup);
    }

    if (albumImageSelector) return;

    // Lazy image attributes on non-img elements
    const lazyGroup = extractFromLazyAttributes(el, extractorContext);
    if (lazyGroup) enqueueGroup(lazyGroup);

    // CSS background-image
    const bgGroups = extractFromCssBackground(el, extractorContext);
    for (const g of bgGroups) {
      enqueueGroup(g);
    }
  }

  function runNextSlice() {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    isSliceRunning = true;
    sliceTimer = null;

    const sliceStart = performance.now();

    while (pendingIndex < pendingElements.length || discoveryIndex < discoveryTasks.length) {
      if (inFlightBatches >= 2) {
        waitingForBatch = true;
        return;
      }
      try {
        let el: Element | undefined;
        if (pendingIndex < pendingElements.length) {
          el = pendingElements[pendingIndex++];
        } else {
          const next = discoveryTasks[discoveryIndex]!.next();
          if (next.done) discoveryIndex++;
          else el = next.value;
        }
        if (el?.isConnected && el.matches(MEDIA_TARGET_SELECTOR)) processElement(el);
      } catch (error) {
        if (String(error).includes('WIC_DATA_CACHE_LIMIT')) {
          if (!cacheLimitReached) safeSendMessage({ channel: 'WIC_CONTENT_TO_BG', type: 'CONTENT_SCAN_STATUS',
            scanEpoch: currentScanEpoch, pageUrl: window.location.href, status: 'limit_reached' }, destroy);
          cacheLimitReached = true;
        }
        else console.warn('[WIC Content] Skipped an unavailable media element:', error);
      }

      // Check time slice budget (8ms)
      if (performance.now() - sliceStart >= SCAN_CHUNK_BUDGET_MS) {
        sliceTimer = window.setTimeout(runNextSlice, 0);
        return;
      }
    }

    // Slice queue emptied
    isSliceRunning = false;
    pendingElements = [];
    pendingIndex = 0;
    discoveryTasks = [];
    discoveryIndex = 0;
    flushBatch();
    if (inFlightBatches > 0) {
      waitingForBatch = true;
      isSliceRunning = true;
      return;
    }

    if (reportedComplete) return;
    reportedComplete = true;

    // Notify background SW that initial traversal for current scanEpoch is done
    const statusMsg: ContentToBackgroundMessage = {
      channel: 'WIC_CONTENT_TO_BG',
      type: 'CONTENT_SCAN_STATUS',
      scanEpoch: currentScanEpoch,
      pageUrl: window.location.href,
      pageTitle: document.title || undefined,
      status: cacheLimitReached ? 'limit_reached' : 'watching',
    };
    safeSendMessage(statusMsg, destroy);
  }

  function scheduleElements(elements: Element[]) {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    for (const el of elements) {
      if (pendingElements.length - pendingIndex >= MAX_PENDING_SCAN_NODES) break;
      pendingElements.push(el);
    }

    if (!isSliceRunning && sliceTimer === null) {
      sliceTimer = window.setTimeout(runNextSlice, 0);
    }
  }

  // MutationObserver for dynamic additions / attribute changes (e.g. manual scroll or SPA player mount)
  let mutationDebounceTimer: number | null = null;
  const mutatedElements = new Set<Element>();

  const observer = new MutationObserver((mutations) => {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    for (const mut of mutations) {
      if (mut.type === 'childList') {
        for (let i = 0; i < mut.addedNodes.length; i++) {
          const node = mut.addedNodes[i];
          if (node instanceof Element) {
            if (mutatedElements.size < MAX_PENDING_SCAN_NODES) mutatedElements.add(node);
          }
        }
      } else if (mut.type === 'attributes') {
        if (mut.attributeName === 'style' && mut.target instanceof Element &&
          !/background|url\(/i.test(mut.target.getAttribute('style') ?? '')) continue;
        if (mut.target instanceof Element && mut.target.matches(MEDIA_TARGET_SELECTOR) && mutatedElements.size < MAX_PENDING_SCAN_NODES) {
          mutatedElements.add(mut.target);
        }
      }
    }

    if (mutatedElements.size === 0 || mutationDebounceTimer !== null) return;
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      if (isDestroyed || !isExtensionContextValid()) {
        destroy();
        return;
      }
      if (mutatedElements.size > 0) {
        const batch = Array.from(mutatedElements);
        mutatedElements.clear();
        if (discoveryTasks.length - discoveryIndex + batch.length >= MAX_PENDING_SCAN_NODES) {
          discoveryTasks = [discover(document)];
          discoveryIndex = 0;
        } else {
          for (const root of batch) discoveryTasks.push(discover(root));
        }
        scheduleElements([]);
      }
    }, MUTATION_DEBOUNCE_MS);
  });

  // Track late image loads via capture phase load listener
  const onCaptureLoad = (e: Event) => {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    const target = e.target;
    if (target instanceof HTMLImageElement) {
      if (target.naturalWidth > 0 && target.naturalHeight > 0) scheduleElements([target]);
    }
  };

  // Passively track video metadata when the webpage itself loads/plays a video
  const onCaptureVideoMetadata = (e: Event) => {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }
    const target = e.target;
    if (target instanceof HTMLVideoElement) {
      const url = target.currentSrc || target.src;
      if (!url || isKnownAdOrTrackerVideoUrl(url)) return;

      const d = target.duration;
      const isLive = d === Number.POSITIVE_INFINITY;
      const durationSec = !isLive && Number.isFinite(d) && d > 0 ? d : null;
      const posterUrl = target.poster ? undefined : tryCaptureReadyVideoFrame(target);

      const msg: ContentToBackgroundMessage = {
        channel: 'WIC_CONTENT_TO_BG',
        type: 'CONTENT_VIDEO_METADATA_LOADED',
        scanEpoch: currentScanEpoch,
        url,
        videoWidth: target.videoWidth > 0 ? target.videoWidth : null,
        videoHeight: target.videoHeight > 0 ? target.videoHeight : null,
        durationSec,
        isLive: isLive || undefined,
        posterUrl,
        isDrmProtected: Boolean(target.mediaKeys !== null) || undefined,
      };
      safeSendMessage(msg, destroy);
    }
  };

  const onCaptureVideoEncrypted = (e: Event) => {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }
    const target = e.target;
    if (target instanceof HTMLVideoElement) {
      const url = target.currentSrc || target.src;
      if (!url || isKnownAdOrTrackerVideoUrl(url)) return;

      const msg: ContentToBackgroundMessage = {
        channel: 'WIC_CONTENT_TO_BG',
        type: 'CONTENT_VIDEO_METADATA_LOADED',
        scanEpoch: currentScanEpoch,
        url,
        videoWidth: target.videoWidth > 0 ? target.videoWidth : null,
        videoHeight: target.videoHeight > 0 ? target.videoHeight : null,
        durationSec: null,
        isDrmProtected: true,
      };
      safeSendMessage(msg, destroy);
    }
  };

  return {
    startOrRescan(scanEpoch: number, replay = false) {
      if (!isExtensionContextValid()) {
        destroy();
        return;
      }

      // Resume from destroyed state if requested
      isDestroyed = false;
      albumImageSelector = getXasiatAlbumImageSelector(window.location.href);
      ensureObserving();

      currentScanEpoch = scanEpoch;
      runGeneration++;
      inFlightBatches = 0;
      waitingForBatch = false;
      if (replay) {
        lastSentGroups.clear();
        signatureChars = 0;
        networkObserver.resetSeenUrls();
      }
      reportedComplete = false;
      cacheLimitReached = false;
      totalCandidatesSent = 0;
      if (sliceTimer !== null) {
        clearTimeout(sliceTimer);
        sliceTimer = null;
      }
      isSliceRunning = false;
      pendingElements = [];
      pendingIndex = 0;
      batchBuffer = [];
      videoBatchBuffer = [];
      mutatedElements.clear();
      if (mutationDebounceTimer !== null) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = null;

      // Notify scan in progress
      const statusMsg: ContentToBackgroundMessage = {
        channel: 'WIC_CONTENT_TO_BG',
        type: 'CONTENT_SCAN_STATUS',
        scanEpoch: currentScanEpoch,
        pageUrl: window.location.href,
        pageTitle: document.title || undefined,
        status: 'scanning',
      };
      safeSendMessage(statusMsg, destroy);

      discoveryTasks = [discoverMetadata(), discover(document)];
      discoveryIndex = 0;
      scheduleElements([]);
    },
    destroy,
  };
}

import {
  MUTATION_DEBOUNCE_MS,
  OBSERVED_MUTATION_ATTRIBUTES,
  SCAN_BATCH_INTERVAL_MS,
  SCAN_BATCH_MAX_SIZE,
  SCAN_CHUNK_BUDGET_MS,
} from '@shared/constants';
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
  collectShadowDomVideos,
  extractFromVideoElement,
  extractFromVideoLinkOrLazyElement,
  extractPageMetadataVideos,
  tryCaptureReadyVideoFrame,
} from './video-extractor';

export interface ChunkRunnerController {
  startOrRescan(scanEpoch: number): void;
  destroy(): void;
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
): void {
  if (!isExtensionContextValid()) {
    onInvalidated?.();
    return;
  }

  try {
    const promise = chrome.runtime.sendMessage(message);
    if (promise && typeof promise.catch === 'function') {
      promise.catch((err: unknown) => {
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
  let elementCounter = 0;
  let domOrderCounter = 0;
  const elementIdMap = new WeakMap<Element, number>();
  const shadowVideoSet = new WeakSet<HTMLVideoElement>();

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

  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

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

    safeSendMessage(message, destroy);
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
    batchBuffer.push(group);
    scheduleFlushCheck();
  }

  function enqueueVideoGroup(group: RawVideoCandidateGroup) {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }
    videoBatchBuffer.push(group);
    scheduleFlushCheck();
  }

  // Active queue of elements pending inspection
  let pendingElements: Element[] = [];
  let pendingIndex = 0; // O(1) pointer instead of O(N) array.shift()
  let isSliceRunning = false;
  let sliceTimer: number | null = null;

  function processElement(el: Element) {
    if (el instanceof HTMLImageElement) {
      const group = extractFromImageElement(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    if (el instanceof HTMLVideoElement) {
      const { videoGroup, posterImageGroup } = extractFromVideoElement(
        el,
        extractorContext,
        shadowVideoSet.has(el),
      );
      if (videoGroup) enqueueVideoGroup(videoGroup);
      if (posterImageGroup) enqueueGroup(posterImageGroup);
      return;
    }

    if (el instanceof HTMLSourceElement) {
      if (el.parentElement instanceof HTMLVideoElement) {
        const { videoGroup, posterImageGroup } = extractFromVideoElement(
          el.parentElement,
          extractorContext,
          shadowVideoSet.has(el.parentElement),
        );
        if (videoGroup) enqueueVideoGroup(videoGroup);
        if (posterImageGroup) enqueueGroup(posterImageGroup);
      }
      return;
    }

    if (el instanceof SVGImageElement) {
      const group = extractFromSvgImage(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    // Video links (<a href="*.mp4">) & explicit lazy video attributes
    const videoLinkGroup = extractFromVideoLinkOrLazyElement(el, extractorContext);
    if (videoLinkGroup) {
      enqueueVideoGroup(videoLinkGroup);
    }

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

    while (pendingIndex < pendingElements.length) {
      const el = pendingElements[pendingIndex++];
      if (el) {
        processElement(el);
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
    flushBatch();

    console.log(
      `[WIC Content] Scan complete for epoch ${currentScanEpoch}. Total candidates: ${totalCandidatesSent}`,
    );

    // Notify background SW that initial traversal for current scanEpoch is done
    const statusMsg: ContentToBackgroundMessage = {
      channel: 'WIC_CONTENT_TO_BG',
      type: 'CONTENT_SCAN_STATUS',
      scanEpoch: currentScanEpoch,
      pageUrl: window.location.href,
      pageTitle: document.title || undefined,
      status: 'watching',
    };
    safeSendMessage(statusMsg, destroy);
  }

  function scheduleElements(elements: Element[]) {
    if (isDestroyed || !isExtensionContextValid()) {
      destroy();
      return;
    }

    for (const el of elements) {
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
            if (node.matches(MEDIA_TARGET_SELECTOR)) {
              mutatedElements.add(node);
            }
            const descendants = node.querySelectorAll(MEDIA_TARGET_SELECTOR);
            for (let j = 0; j < descendants.length; j++) {
              mutatedElements.add(descendants[j]!);
            }
            if (node.shadowRoot) {
              const sVideos = collectShadowDomVideos(node.shadowRoot);
              for (const sv of sVideos) {
                shadowVideoSet.add(sv);
                mutatedElements.add(sv);
              }
            }
          }
        }
      } else if (mut.type === 'attributes') {
        if (mut.target instanceof Element) {
          mutatedElements.add(mut.target);
        }
      }
    }

    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
    }
    mutationDebounceTimer = window.setTimeout(() => {
      mutationDebounceTimer = null;
      if (isDestroyed || !isExtensionContextValid()) {
        destroy();
        return;
      }
      if (mutatedElements.size > 0) {
        const batch = Array.from(mutatedElements);
        mutatedElements.clear();
        scheduleElements(batch);
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
      if (target.naturalWidth > 0 && target.naturalHeight > 0) {
        const url = target.currentSrc || target.src;
        if (url) {
          const msg: ContentToBackgroundMessage = {
            channel: 'WIC_CONTENT_TO_BG',
            type: 'CONTENT_IMAGE_LOADED_DIMENSIONS',
            scanEpoch: currentScanEpoch,
            url,
            naturalWidth: target.naturalWidth,
            naturalHeight: target.naturalHeight,
          };
          safeSendMessage(msg, destroy);
        }
      }
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
      if (!url) return;

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
      if (!url) return;

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
    startOrRescan(scanEpoch: number) {
      if (!isExtensionContextValid()) {
        destroy();
        return;
      }

      // Resume from destroyed state if requested
      isDestroyed = false;
      ensureObserving();

      currentScanEpoch = scanEpoch;
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

      // Layer 2: Passive OGP / JSON-LD metadata extraction
      const metaVideoGroups = extractPageMetadataVideos(document, extractorContext);
      for (const g of metaVideoGroups) {
        enqueueVideoGroup(g);
      }

      // Layer 3: Passive buffered PerformanceResourceTiming inspection
      const networkVideoGroups = networkObserver.scanBufferedEntries();
      for (const g of networkVideoGroups) {
        enqueueVideoGroup(g);
      }

      // Layer 1: Targeted fast DOM query + Open Shadow DOM videos
      const directTargets = Array.from(document.querySelectorAll(MEDIA_TARGET_SELECTOR));
      const shadowVideos = collectShadowDomVideos(document);
      for (const sv of shadowVideos) {
        shadowVideoSet.add(sv);
        directTargets.push(sv);
      }

      console.log(
        `[WIC Content] Starting scan for epoch ${scanEpoch}. Found ${directTargets.length} potential media elements.`,
      );
      scheduleElements(directTargets);
    },
    destroy,
  };
}

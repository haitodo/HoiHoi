import {
  MUTATION_DEBOUNCE_MS,
  OBSERVED_MUTATION_ATTRIBUTES,
  SCAN_BATCH_INTERVAL_MS,
  SCAN_BATCH_MAX_SIZE,
  SCAN_CHUNK_BUDGET_MS,
} from '@shared/constants';
import type { ContentToBackgroundMessage } from '@shared/messages';
import type { RawCandidateGroup } from '@shared/types';
import {
  extractFromCssBackground,
  extractFromImageElement,
  extractFromLazyAttributes,
  extractFromSvgImage,
  type ExtractorContext,
} from './dom-extractor';

export interface ChunkRunnerController {
  startOrRescan(scanEpoch: number): void;
  destroy(): void;
}

export function createChunkRunner(options: {
  largeDataUrlStore: Map<string, string>;
}): ChunkRunnerController {
  const { largeDataUrlStore } = options;

  let currentScanEpoch = 0;
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

  // Batch buffer for candidate groups
  let batchBuffer: RawCandidateGroup[] = [];
  let batchFlushTimer: number | null = null;

  function flushBatch() {
    if (batchFlushTimer !== null) {
      clearTimeout(batchFlushTimer);
      batchFlushTimer = null;
    }

    if (batchBuffer.length === 0) return;

    const groupsToSend = batchBuffer;
    batchBuffer = [];

    const message: ContentToBackgroundMessage = {
      channel: 'WIC_CONTENT_TO_BG',
      type: 'CONTENT_SCAN_BATCH',
      scanEpoch: currentScanEpoch,
      pageUrl: window.location.href,
      groups: groupsToSend,
    };

    chrome.runtime.sendMessage(message).catch(() => {
      // Background SW may be momentarily sleeping or restarting
    });
  }

  function enqueueGroup(group: RawCandidateGroup) {
    batchBuffer.push(group);
    if (batchBuffer.length >= SCAN_BATCH_MAX_SIZE) {
      flushBatch();
    } else if (batchFlushTimer === null) {
      batchFlushTimer = window.setTimeout(flushBatch, SCAN_BATCH_INTERVAL_MS);
    }
  }

  // Active queue of elements pending inspection
  let pendingElements: Element[] = [];
  let isSliceRunning = false;
  let sliceTimer: number | null = null;

  function processElement(el: Element) {
    if (el instanceof HTMLImageElement) {
      const group = extractFromImageElement(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    if (el instanceof SVGImageElement) {
      const group = extractFromSvgImage(el, extractorContext);
      if (group) enqueueGroup(group);
      return;
    }

    // Lazy attributes on non-img elements
    const lazyGroup = extractFromLazyAttributes(el, extractorContext);
    if (lazyGroup) enqueueGroup(lazyGroup);

    // CSS background-image
    const bgGroups = extractFromCssBackground(el, extractorContext);
    for (const g of bgGroups) {
      enqueueGroup(g);
    }
  }

  function runNextSlice() {
    isSliceRunning = true;
    sliceTimer = null;

    const sliceStart = performance.now();

    while (pendingElements.length > 0) {
      const el = pendingElements.shift();
      if (el) {
        processElement(el);
      }

      // Check time slice budget
      if (performance.now() - sliceStart >= SCAN_CHUNK_BUDGET_MS) {
        sliceTimer = window.setTimeout(runNextSlice, 0);
        return;
      }
    }

    // Slice queue emptied
    isSliceRunning = false;
    flushBatch();

    // Notify background SW that initial traversal for current scanEpoch is done
    const statusMsg: ContentToBackgroundMessage = {
      channel: 'WIC_CONTENT_TO_BG',
      type: 'CONTENT_SCAN_STATUS',
      scanEpoch: currentScanEpoch,
      pageUrl: window.location.href,
      status: 'watching',
    };
    chrome.runtime.sendMessage(statusMsg).catch(() => {});
  }

  function scheduleElements(elements: Element[]) {
    for (const el of elements) {
      pendingElements.push(el);
    }
    if (!isSliceRunning && sliceTimer === null) {
      sliceTimer = window.setTimeout(runNextSlice, 0);
    }
  }

  // MutationObserver for dynamic additions / attribute changes (e.g. manual scroll)
  let mutationDebounceTimer: number | null = null;
  const mutatedElements = new Set<Element>();

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      if (mut.type === 'childList') {
        for (let i = 0; i < mut.addedNodes.length; i++) {
          const node = mut.addedNodes[i];
          if (node instanceof Element) {
            mutatedElements.add(node);
            const descendants = node.querySelectorAll('*');
            for (let j = 0; j < descendants.length; j++) {
              mutatedElements.add(descendants[j]!);
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
      if (mutatedElements.size > 0) {
        const batch = Array.from(mutatedElements);
        mutatedElements.clear();
        scheduleElements(batch);
      }
    }, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: OBSERVED_MUTATION_ATTRIBUTES as string[],
  });

  // Track late image loads via capture phase load listener
  const onCaptureLoad = (e: Event) => {
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
          chrome.runtime.sendMessage(msg).catch(() => {});
        }
      }
    }
  };
  window.addEventListener('load', onCaptureLoad, true);

  return {
    startOrRescan(scanEpoch: number) {
      currentScanEpoch = scanEpoch;
      // Abort any in-progress slices and clear buffers
      if (sliceTimer !== null) {
        clearTimeout(sliceTimer);
        sliceTimer = null;
      }
      isSliceRunning = false;
      pendingElements = [];
      batchBuffer = [];

      // Notify scan in progress
      const statusMsg: ContentToBackgroundMessage = {
        channel: 'WIC_CONTENT_TO_BG',
        type: 'CONTENT_SCAN_STATUS',
        scanEpoch: currentScanEpoch,
        pageUrl: window.location.href,
        status: 'scanning',
      };
      chrome.runtime.sendMessage(statusMsg).catch(() => {});

      // Collect initial DOM snapshot
      const allElements = Array.from(document.querySelectorAll('*'));
      scheduleElements(allElements);
    },
    destroy() {
      if (sliceTimer !== null) clearTimeout(sliceTimer);
      if (batchFlushTimer !== null) clearTimeout(batchFlushTimer);
      if (mutationDebounceTimer !== null) clearTimeout(mutationDebounceTimer);
      observer.disconnect();
      window.removeEventListener('load', onCaptureLoad, true);
    },
  };
}

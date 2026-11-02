import type { RawVideoCandidateGroup } from '@shared/types';
import { MAX_VIDEOS_PER_TAB } from '@shared/constants';
import {
  isKnownAdOrTrackerVideoUrl,
  isLikelyVideoUrl,
  isSegmentChunkNoiseUrl,
  resolveAndValidateVideoUrl,
} from '@shared/video-utils';
import type { ExtractorContext } from './dom-extractor';

export interface NetworkMediaObserverController {
  scanBufferedEntries(): RawVideoCandidateGroup[];
  startObserving(onDiscovered: (groups: RawVideoCandidateGroup[]) => void): void;
  stopObserving(): void;
  resetSeenUrls(): void;
}

/**
 * Layer 3: Zero-permission, zero-network-traffic passive media detector backed by
 * `PerformanceResourceTiming`. Captures `.mp4`, `.webm`, `.m3u8`, `.mpd` URLs loaded by
 * page scripts (`fetch` / `XHR` / `<video>`) while filtering out `.ts` / `.m4s` segment noise.
 */
export function createNetworkMediaObserver(
  ctx: ExtractorContext,
): NetworkMediaObserverController {
  const seenUrls = new Set<string>();
  let perfObserver: PerformanceObserver | null = null;

  function entryToCandidateGroup(
    entry: PerformanceResourceTiming,
  ): RawVideoCandidateGroup | null {
    const rawUrl = entry.name;
    if (seenUrls.size >= MAX_VIDEOS_PER_TAB) return null;
    if (!rawUrl || seenUrls.has(rawUrl)) return null;

    const resolved = resolveAndValidateVideoUrl(rawUrl, ctx.baseUri);
    if (!resolved || seenUrls.has(resolved)) return null;

    if (isSegmentChunkNoiseUrl(resolved) || isKnownAdOrTrackerVideoUrl(resolved)) {
      return null;
    }

    const initiator = entry.initiatorType?.toLowerCase() ?? '';
    const isMediaInitiator = initiator === 'video';

    if (!isMediaInitiator && !isLikelyVideoUrl(resolved)) {
      return null;
    }

    // Even if initiatorType === 'video', skip poster images so they don't pollute video tab
    if (/\.(jpe?g|png|gif|webp|avif|svg|ico)(?:[?#]|$)/i.test(resolved)) {
      return null;
    }

    seenUrls.add(resolved);

    const bodyBytes =
      typeof entry.encodedBodySize === 'number' && entry.encodedBodySize > 0
        ? entry.encodedBodySize
        : null;

    return {
      occurrenceKey: `net::resource::${resolved}`,
      primaryUrl: resolved,
      domOrder: ctx.domOrderCounter(),
      durationSec: null,
      variants: [
        {
          url: resolved,
          role: 'network',
          source: 'network-resource',
          videoWidth: null,
          videoHeight: null,
          fileSizeBytes: bodyBytes,
        },
      ],
    };
  }

  return {
    scanBufferedEntries(): RawVideoCandidateGroup[] {
      const groups: RawVideoCandidateGroup[] = [];
      try {
        const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        for (let i = 0; i < entries.length; i++) {
          const group = entryToCandidateGroup(entries[i]!);
          if (group) {
            groups.push(group);
          }
        }
      } catch {
        // Ignore if Performance API is unavailable
      }
      return groups;
    },

    startObserving(onDiscovered: (groups: RawVideoCandidateGroup[]) => void): void {
      if (perfObserver || typeof PerformanceObserver === 'undefined') return;
      try {
        perfObserver = new PerformanceObserver((list) => {
          const found: RawVideoCandidateGroup[] = [];
          const entries = list.getEntries() as PerformanceResourceTiming[];
          for (let i = 0; i < entries.length; i++) {
            const g = entryToCandidateGroup(entries[i]!);
            if (g) found.push(g);
          }
          if (found.length > 0) {
            onDiscovered(found);
          }
        });
        perfObserver.observe({ type: 'resource', buffered: false });
      } catch {
        perfObserver = null;
      }
    },

    stopObserving(): void {
      if (!perfObserver) return;
      try {
        perfObserver.disconnect();
      } catch {}
      perfObserver = null;
    },
    resetSeenUrls() { seenUrls.clear(); },
  };
}

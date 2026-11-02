import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { getActiveVideoVariant } from '@shared/video-utils';

interface UseVideoMetadataProberOptions {
  videos: VideoItem[];
  targetTabId: number | null;
  enabled: boolean;
  onReportVideoMetadata: (
    itemId: string,
    variantUrl: string,
    width: number | null,
    height: number | null,
    durationSec: number | null,
  ) => void;
}

export interface VideoMetadataProberState {
  isProbing: boolean;
  progress: { current: number; total: number } | null;
  startProbing: () => void;
  stopProbing: () => void;
  unprobedCount: number;
}

const PROBE_TIMEOUT_MS = 4000;

export function useVideoMetadataProber({
  videos,
  onReportVideoMetadata,
  targetTabId,
  enabled,
}: UseVideoMetadataProberOptions): VideoMetadataProberState {
  const [isProbing, setIsProbing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Filter videos that need probing (readiness === 'ready' direct videos with missing dimensions)
  const unprobedVideos = useMemo(() => videos.filter((v) => {
    const active = getActiveVideoVariant(v.variants, v.selectedUrl);
    if (!active || active.readiness !== 'ready') return false;
    // Skip data placeholders or unsupported inline formats
    if (active.largeDataRefId || v.selectedUrl.includes('__WIC_LARGE_DATA_')) return false;
    return !active.videoWidth || !active.videoHeight;
  }), [videos]);

  const stopProbing = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsProbing(false);
    setProgress(null);
  }, []);

  useEffect(() => {
    stopProbing();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [targetTabId, enabled, stopProbing]);

  const probeSingleVideo = (
    url: string,
    signal: AbortSignal,
  ): Promise<{ width: number | null; height: number | null; duration: number | null }> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      let settled = false;
      const finish = (result = { width: null as number | null, height: null as number | null, duration: null as number | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        signal.removeEventListener('abort', onAbort);
        video.removeAttribute('src');
        video.load(); // Immediately terminate buffering & network connection
        resolve(result);
      };

      const onAbort = () => finish();

      const timer = setTimeout(() => {
        finish();
      }, PROBE_TIMEOUT_MS);

      video.onloadedmetadata = () => {
        const w = video.videoWidth > 0 ? video.videoWidth : null;
        const h = video.videoHeight > 0 ? video.videoHeight : null;
        const dur =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        finish({ width: w, height: h, duration: dur });
      };

      video.onerror = () => {
        finish();
      };

      try {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) { finish(); return; }
        video.src = url;
      } catch {
        finish();
      }
    });
  };

  const startProbing = useCallback(async () => {
    if (!enabled || controllerRef.current || unprobedVideos.length === 0) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsProbing(true);
    const targetList = [...unprobedVideos];
    const total = targetList.length;

    for (let i = 0; i < total; i++) {
      if (controller.signal.aborted) break;
      setProgress({ current: i + 1, total });

      const item = targetList[i]!;
      const selectedUrl = item.selectedUrl;

      const meta = await probeSingleVideo(selectedUrl, controller.signal);
      if (!controller.signal.aborted && (meta.width || meta.height || meta.duration)) {
        onReportVideoMetadata(item.itemId, selectedUrl, meta.width, meta.height, meta.duration);
      }

      // Small 40ms yield to prevent UI freeze and give browser event loop breathing room
      await new Promise((r) => setTimeout(r, 40));
    }

    if (controllerRef.current === controller) {
      controllerRef.current = null;
      setIsProbing(false);
      setProgress(null);
    }
  }, [enabled, unprobedVideos, onReportVideoMetadata]);

  return {
    isProbing,
    progress,
    startProbing,
    stopProbing,
    unprobedCount: unprobedVideos.length,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoItem } from '@shared/types';
import { getActiveVideoVariant } from '@shared/video-utils';

interface UseVideoMetadataProberOptions {
  videos: VideoItem[];
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
}: UseVideoMetadataProberOptions): VideoMetadataProberState {
  const [isProbing, setIsProbing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const abortRef = useRef(false);

  // Filter videos that need probing (readiness === 'ready' direct videos with missing dimensions)
  const unprobedVideos = videos.filter((v) => {
    const active = getActiveVideoVariant(v.variants, v.selectedUrl);
    if (!active || active.readiness !== 'ready') return false;
    // Skip data placeholders or unsupported inline formats
    if (v.selectedUrl.startsWith('data:__WIC_LARGE')) return false;
    return !active.videoWidth || !active.videoHeight;
  });

  const stopProbing = useCallback(() => {
    abortRef.current = true;
    setIsProbing(false);
    setProgress(null);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const probeSingleVideo = (
    url: string,
  ): Promise<{ width: number | null; height: number | null; duration: number | null }> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load(); // Immediately terminate buffering & network connection
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve({ width: null, height: null, duration: null });
      }, PROBE_TIMEOUT_MS);

      video.onloadedmetadata = () => {
        const w = video.videoWidth > 0 ? video.videoWidth : null;
        const h = video.videoHeight > 0 ? video.videoHeight : null;
        const dur =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        cleanup();
        resolve({ width: w, height: h, duration: dur });
      };

      video.onerror = () => {
        cleanup();
        resolve({ width: null, height: null, duration: null });
      };

      try {
        video.src = url;
      } catch {
        cleanup();
        resolve({ width: null, height: null, duration: null });
      }
    });
  };

  const startProbing = useCallback(async () => {
    if (isProbing || unprobedVideos.length === 0) return;

    abortRef.current = false;
    setIsProbing(true);
    const targetList = [...unprobedVideos];
    const total = targetList.length;

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;
      setProgress({ current: i + 1, total });

      const item = targetList[i]!;
      const selectedUrl = item.selectedUrl;

      const meta = await probeSingleVideo(selectedUrl);
      if (!abortRef.current && (meta.width || meta.height || meta.duration)) {
        onReportVideoMetadata(item.itemId, selectedUrl, meta.width, meta.height, meta.duration);
      }

      // Small 40ms yield to prevent UI freeze and give browser event loop breathing room
      await new Promise((r) => setTimeout(r, 40));
    }

    setIsProbing(false);
    setProgress(null);
  }, [isProbing, unprobedVideos, onReportVideoMetadata]);

  return {
    isProbing,
    progress,
    startProbing,
    stopProbing,
    unprobedCount: unprobedVideos.length,
  };
}

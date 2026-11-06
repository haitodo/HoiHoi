import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CardSize, ItemDownloadState, VideoItem } from '@shared/types';
import type { HlsStreamMergeProgress } from '../utils/hls-saver';
import { VideoCard } from './VideoCard';

interface VideoGridProps {
  isActive?: boolean;
  videos: VideoItem[];
  selectedVideoIds: Set<string>;
  downloads: Record<string, ItemDownloadState>;
  cardSize?: CardSize;
  onToggleSelect: (itemId: string, e: React.MouseEvent) => void;
  onSelectVariant: (itemId: string, variantUrl: string) => void;
  onReportVideoMetadata: (
    itemId: string,
    variantUrl: string,
    width: number | null,
    height: number | null,
    durationSec: number | null,
  ) => void;
  onResolveHlsManifest: (itemId: string, manifestUrl: string) => Promise<void>;
  onMergeHlsStream?: (
    itemId: string,
    manifestUrl: string,
    signal: AbortSignal,
    onProgress: (progress: HlsStreamMergeProgress) => void,
  ) => Promise<void>;
  onDownloadVideo: (itemId: string) => void;
  onCancelDownload: (itemId: string) => void;
  onOpenPreview?: (video: VideoItem) => void;
}

const CARD_GAP = 10;

const VIDEO_STAGE_HEIGHTS: Record<CardSize, number> = {
  large: 230,
  auto: 156,
  medium: 156,
  small: 112,
};

const ESTIMATED_VIDEO_ROW_HEIGHTS: Record<CardSize, number> = {
  large: 340,
  auto: 268,
  medium: 268,
  small: 220,
};

function calculateVideoColumns(containerWidth: number, size: CardSize): number {
  if (size === 'large') {
    if (containerWidth >= 820) return 2;
    return 1;
  }
  if (size === 'small') {
    if (containerWidth >= 680) return 3;
    if (containerWidth >= 340) return 2;
    return 1;
  }
  // auto / medium: 1 column on narrow sidepanel (<460px) for clear 16:9 preview, 2+ on wider panels
  if (containerWidth >= 780) return 3;
  if (containerWidth >= 460) return 2;
  return 1;
}

export const VideoGrid: React.FC<VideoGridProps> = ({
  isActive = true,
  videos,
  selectedVideoIds,
  downloads,
  cardSize = 'auto',
  onToggleSelect,
  onSelectVariant,
  onReportVideoMetadata,
  onResolveHlsManifest,
  onMergeHlsStream,
  onDownloadVideo,
  onCancelDownload,
  onOpenPreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);
  // Singleton inline player guard: at most ONE <video> element can ever exist in the grid
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) setActivePlayingId(null);
  }, [isActive]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = (width: number) => {
      if (width <= 0) return;
      const cols = calculateVideoColumns(width, cardSize);
      setColumnCount((prev) => (prev !== cols ? cols : prev));
    };

    updateColumns(el.clientWidth || el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        updateColumns(entry.contentRect.width);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [cardSize]);

  // Clear inline player if the playing item was filtered out
  useEffect(() => {
    if (activePlayingId && !videos.some((v) => v.itemId === activePlayingId)) {
      setActivePlayingId(null);
    }
  }, [videos, activePlayingId]);

  const rows = useMemo(() => {
    const result: VideoItem[][] = [];
    for (let i = 0; i < videos.length; i += columnCount) {
      result.push(videos.slice(i, i + columnCount));
    }
    return result;
  }, [videos, columnCount]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_VIDEO_ROW_HEIGHTS[cardSize],
    overscan: 3,
  });

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '8px 10px',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowVideos = rows[virtualRow.index];
          if (!rowVideos) return null;

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                gap: CARD_GAP,
                paddingBottom: CARD_GAP,
                boxSizing: 'border-box',
              }}
            >
              {rowVideos.map((video) => (
                <VideoCard
                  key={video.itemId}
                  item={video}
                  isSelected={selectedVideoIds.has(video.itemId)}
                  isInlinePlaying={activePlayingId === video.itemId}
                  downloadState={downloads[video.itemId]}
                  cardSize={cardSize}
                  thumbnailHeight={VIDEO_STAGE_HEIGHTS[cardSize]}
                  onToggleSelect={(e) => onToggleSelect(video.itemId, e)}
                  onToggleInlinePlay={() =>
                    setActivePlayingId((prev) =>
                      prev === video.itemId ? null : video.itemId,
                    )
                  }
                  onSelectVariant={(variantUrl) => onSelectVariant(video.itemId, variantUrl)}
                  onReportVideoMetadata={(variantUrl, w, h, dur) =>
                    onReportVideoMetadata(video.itemId, variantUrl, w, h, dur)
                  }
                  onResolveHlsManifest={(manifestUrl) =>
                    onResolveHlsManifest(video.itemId, manifestUrl)
                  }
                  onMergeHlsStream={
                    onMergeHlsStream
                      ? (manifestUrl, signal, onProgress) =>
                          onMergeHlsStream(video.itemId, manifestUrl, signal, onProgress)
                      : undefined
                  }
                  onDownload={() => onDownloadVideo(video.itemId)}
                  onCancelDownload={() => onCancelDownload(video.itemId)}
                  onOpenPreview={
                    onOpenPreview
                      ? () => {
                          setActivePlayingId(null); // Stop inline player when opening modal
                          onOpenPreview(video);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

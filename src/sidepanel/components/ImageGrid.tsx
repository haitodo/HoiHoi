import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CardSize, ImageItem, ItemDownloadState } from '@shared/types';
import { ImageCard } from './ImageCard';

interface ImageGridProps {
  items: ImageItem[];
  selectedIds: Set<string>;
  downloads: Record<string, ItemDownloadState>;
  cardSize?: CardSize;
  onToggleSelect: (itemId: string, e: React.MouseEvent) => void;
  onSelectVariant: (itemId: string, variantUrl: string) => void;
  onReportDimensions: (itemId: string, variantUrl: string, width: number, height: number) => void;
  onDownloadItem: (itemId: string) => void;
  onOpenPreview?: (item: ImageItem) => void;
}

const CARD_GAP = 10;

const THUMBNAIL_HEIGHTS: Record<CardSize, number> = {
  large: 380,
  auto: 140,
  medium: 150,
  small: 90,
};

const ESTIMATED_ROW_HEIGHTS: Record<CardSize, number> = {
  large: 460,
  auto: 215,
  medium: 225,
  small: 145,
};

function calculateColumns(containerWidth: number, size: CardSize): number {
  if (size === 'auto') {
    if (containerWidth >= 760) return 5;
    if (containerWidth >= 580) return 4;
    if (containerWidth >= 400) return 3;
    return 2;
  }
  if (size === 'large') {
    // Under 540px width (typical sidepanel), display 1 column for full-width large view
    if (containerWidth >= 960) return 3;
    if (containerWidth >= 540) return 2;
    return 1;
  }
  if (size === 'small') {
    // Small mode: fit as many columns as possible (min 95px)
    return Math.max(2, Math.floor((containerWidth + CARD_GAP) / (95 + CARD_GAP)));
  }
  // Medium mode: standard 2-3 columns (min 150px)
  return Math.max(1, Math.floor((containerWidth + CARD_GAP) / (150 + CARD_GAP)));
}

export const ImageGrid: React.FC<ImageGridProps> = ({
  items,
  selectedIds,
  downloads,
  cardSize = 'auto',
  onToggleSelect,
  onSelectVariant,
  onReportDimensions,
  onDownloadItem,
  onOpenPreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(2);

  // Responsive column count based on side panel container width and chosen card size tier
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = (width: number) => {
      if (width <= 0) return;
      const cols = calculateColumns(width, cardSize);
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

  // Partition items into rows
  const rows = useMemo(() => {
    const result: ImageItem[][] = [];
    for (let i = 0; i < items.length; i += columnCount) {
      result.push(items.slice(i, i + columnCount));
    }
    return result;
  }, [items, columnCount]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHTS[cardSize],
    overscan: 3,
  });

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '8px 6px 8px 8px',
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
          const rowItems = rows[virtualRow.index];
          if (!rowItems) return null;

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
              {rowItems.map((item) => (
                <ImageCard
                  key={item.itemId}
                  item={item}
                  isSelected={selectedIds.has(item.itemId)}
                  downloadState={downloads[item.itemId]}
                  cardSize={cardSize}
                  thumbnailHeight={THUMBNAIL_HEIGHTS[cardSize]}
                  onToggleSelect={(e) => onToggleSelect(item.itemId, e)}
                  onSelectVariant={(variantUrl) => onSelectVariant(item.itemId, variantUrl)}
                  onReportDimensions={(variantUrl, w, h) =>
                    onReportDimensions(item.itemId, variantUrl, w, h)
                  }
                  onDownload={() => onDownloadItem(item.itemId)}
                  onOpenPreview={onOpenPreview ? () => onOpenPreview(item) : undefined}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ImageItem, ItemDownloadState } from '@shared/types';
import { ImageCard } from './ImageCard';

interface ImageGridProps {
  items: ImageItem[];
  selectedIds: Set<string>;
  downloads: Record<string, ItemDownloadState>;
  onToggleSelect: (itemId: string) => void;
  onSelectVariant: (itemId: string, variantUrl: string) => void;
  onReportDimensions: (itemId: string, variantUrl: string, width: number, height: number) => void;
  onDownloadItem: (itemId: string) => void;
}

const CARD_GAP = 10;
const ESTIMATED_ROW_HEIGHT = 200;

export const ImageGrid: React.FC<ImageGridProps> = ({
  items,
  selectedIds,
  downloads,
  onToggleSelect,
  onSelectVariant,
  onReportDimensions,
  onDownloadItem,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(2);

  // Responsive column count based on side panel container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const width = entry.contentRect.width;
        // 2 columns for narrow side panels (<360px), 3 columns for wider panels
        setColumnCount(width >= 400 ? 3 : 2);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
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
                  onToggleSelect={() => onToggleSelect(item.itemId)}
                  onSelectVariant={(variantUrl) => onSelectVariant(item.itemId, variantUrl)}
                  onReportDimensions={(variantUrl, w, h) =>
                    onReportDimensions(item.itemId, variantUrl, w, h)
                  }
                  onDownload={() => onDownloadItem(item.itemId)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

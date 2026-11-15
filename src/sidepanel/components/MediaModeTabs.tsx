import React from 'react';
import type { MediaMode } from '@shared/types';

interface MediaModeTabsProps {
  activeMode: MediaMode;
  onChangeMode: (mode: MediaMode) => void;
  imageCount: number;
  videoCount: number;
  selectedImageCount: number;
  selectedVideoCount: number;
}

export const MediaModeTabs: React.FC<MediaModeTabsProps> = ({
  activeMode,
  onChangeMode,
  imageCount,
  videoCount,
  selectedImageCount,
  selectedVideoCount,
}) => {
  const renderTab = (
    mode: MediaMode,
    label: string,
    count: number,
    selectedCount: number,
  ) => {
    const isActive = activeMode === mode;

    return (
      <button
        key={mode}
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => onChangeMode(mode)}
        style={{
          flex: '1 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '3px 5px',
          minHeight: 26,
          fontSize: 11,
          fontWeight: isActive ? 600 : 500,
          borderRadius: 6,
          border: isActive
            ? '1px solid var(--color-primary-subtle-border)'
            : '1px solid transparent',
          backgroundColor: isActive ? 'var(--color-bg-surface)' : 'transparent',
          color: isActive ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
          boxShadow: isActive ? '0 1px 2px rgba(0, 0, 0, 0.06)' : 'none',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontSize: 11,
            padding: '0 5px',
            borderRadius: 10,
            backgroundColor: isActive
              ? 'var(--color-primary-subtle)'
              : 'var(--color-bg-hover)',
            color: isActive ? 'var(--color-primary-text)' : 'var(--color-text-muted)',
            fontWeight: 600,
          }}
        >
          {count}
        </span>
        {!isActive && selectedCount > 0 && (
          <span
            style={{
              fontSize: 10,
                padding: '0 4px',
              borderRadius: 8,
              backgroundColor: 'var(--color-primary)',
              color: '#ffffff',
              fontWeight: 600,
            }}
            title={`選択中: ${selectedCount}件`}
          >
            ✓{selectedCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      role="tablist"
      aria-label="メディア表示モード切替"
      style={{
        display: 'flex',
        gap: 4,
        flex: '1 0 auto',
      }}
    >
      {renderTab('image', '画像', imageCount, selectedImageCount)}
      {renderTab('video', '動画', videoCount, selectedVideoCount)}
    </div>
  );
};

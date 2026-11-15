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
        className={`mode-tab ${isActive ? 'is-active' : ''}`}
      >
        <span>{label}</span>
        <span className="mode-tab-count">{count}</span>
        {!isActive && selectedCount > 0 && (
          <span className="mode-tab-selected" title={`選択中: ${selectedCount}件`}>
            ✓{selectedCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div role="tablist" aria-label="メディア表示モード切替" className="mode-tabs">
      {renderTab('image', '画像', imageCount, selectedImageCount)}
      {renderTab('video', '動画', videoCount, selectedVideoCount)}
    </div>
  );
};

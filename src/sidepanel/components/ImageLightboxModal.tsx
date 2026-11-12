import React, { useEffect, useState } from 'react';
import type { ImageItem, ItemDownloadState } from '@shared/types';

interface ImageLightboxModalProps {
  items: ImageItem[];
  currentIndex: number;
  isSelected: boolean;
  downloadState?: ItemDownloadState;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleSelect?: (itemId: string) => void;
  onDownload: (itemId: string) => void;
  onSelectVariant: (itemId: string, variantUrl: string) => void;
  onReportDimensions: (itemId: string, variantUrl: string, width: number, height: number) => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  items,
  currentIndex,
  isSelected,
  downloadState,
  onClose,
  onNavigate,
  onToggleSelect,
  onDownload,
  onSelectVariant,
  onReportDimensions,
}) => {
  const [copied, setCopied] = useState(false);
  const currentItem = items[currentIndex];

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (hasPrev) onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight') {
        if (hasNext) onNavigate(currentIndex + 1);
      } else if (currentItem && onToggleSelect && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        onToggleSelect(currentItem.itemId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, hasPrev, hasNext, currentItem, onClose, onNavigate, onToggleSelect]);

  if (!currentItem) return null;

  const activeVariant =
    currentItem.variants.find((v) => v.url === currentItem.selectedUrl) ||
    currentItem.variants[0];
  const selectedUrl = currentItem.selectedUrl;
  const checked = Boolean(onToggleSelect && isSelected);

  const dimsText =
    activeVariant?.naturalWidth && activeVariant?.naturalHeight
      ? `${activeVariant.naturalWidth} × ${activeVariant.naturalHeight} px`
      : '寸法不明';
  const formatText = activeVariant?.format.toUpperCase() || 'UNKNOWN';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Failed to copy URL:', err);
    }
  };

  const handleOpenOriginal = () => {
    chrome.tabs.create({ url: selectedUrl, active: false });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '12px',
        boxSizing: 'border-box',
        backdropFilter: 'blur(3px)',
      }}
    >
      {/* Header Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#ffffff',
          fontSize: 12,
          padding: '4px 6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontWeight: 600,
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
            }}
          >
            {currentIndex + 1} / {items.length}
          </span>
          <span style={{ color: '#d1d5db', fontSize: 11 }}>
            {dimsText} • {formatText}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#ffffff',
            fontSize: 20,
            cursor: 'pointer',
            padding: '2px 8px',
            lineHeight: 1,
            borderRadius: 4,
          }}
          title="閉じる (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Main Image Stage */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          minHeight: 0,
          margin: '8px 0',
        }}
      >
        {/* Previous Button */}
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            style={{
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '50%',
              width: 38,
              height: 38,
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              transition: 'background-color 0.15s ease',
            }}
            title="前の画像 (←)"
          >
            ◀
          </button>
        )}

        {/* Image Preview */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src={selectedUrl}
            alt="Preview"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0 && (!activeVariant?.naturalWidth || !activeVariant?.naturalHeight)) {
                onReportDimensions(currentItem.itemId, selectedUrl, naturalWidth, naturalHeight);
              }
            }}
            style={{
              maxWidth: '94%',
              maxHeight: 'calc(100vh - 180px)',
              objectFit: 'contain',
              borderRadius: 6,
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            }}
          />
        </div>

        {/* Next Button */}
        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '50%',
              width: 38,
              height: 38,
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              transition: 'background-color 0.15s ease',
            }}
            title="次の画像 (→)"
          >
            ▶
          </button>
        )}
      </div>

      {/* Footer Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'rgba(30, 30, 30, 0.95)',
          borderRadius: 8,
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: '#ffffff',
        }}
      >
        {/* Action Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {/* Selection Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: onToggleSelect ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 600,
              color: checked ? 'var(--color-primary-text)' : '#ffffff',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!onToggleSelect}
              onChange={() => onToggleSelect?.(currentItem.itemId)}
              style={{ width: 16, height: 16 }}
            />
            <span>{checked ? '✓ 選択中' : onToggleSelect ? '選択する (Space)' : '寸法の確認が必要です'}</span>
          </label>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => onDownload(currentItem.itemId)}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: 'var(--color-primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              保存する
            </button>

            <button
              type="button"
              onClick={handleOpenOriginal}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                backgroundColor: '#374151',
                color: '#ffffff',
                border: '1px solid #4b5563',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              title="新しいタブで画像を開く"
            >
              別タブで開く
            </button>

            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                backgroundColor: copied ? '#065f46' : '#374151',
                color: '#ffffff',
                border: '1px solid #4b5563',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              title="URLをコピー"
            >
              {copied ? 'コピー完了' : 'URLコピー'}
            </button>
          </div>
        </div>

        {/* Variant selector dropdown if multiple candidates exist */}
        {currentItem.variants.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ color: '#9ca3af', whiteSpace: 'nowrap' }}>候補:</span>
            <select
              value={selectedUrl}
              onChange={(e) => onSelectVariant(currentItem.itemId, e.target.value)}
              style={{
                flex: 1,
                fontSize: 11,
                padding: '3px 6px',
                backgroundColor: '#1f2937',
                color: '#ffffff',
                border: '1px solid #4b5563',
                borderRadius: 4,
              }}
            >
              {currentItem.variants.map((v, idx) => {
                const desc = v.descriptors.length > 0 ? ` (${v.descriptors.join(', ')})` : '';
                const roleLabel = v.roles.includes('link-target')
                  ? '高解像度（リンク先）'
                  : v.roles.includes('current-src')
                    ? '表示画像'
                    : `候補 ${idx + 1}`;
                return (
                  <option key={v.url} value={v.url}>
                    {roleLabel} {desc} ({v.naturalWidth ? `${v.naturalWidth}×${v.naturalHeight}` : v.format})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Keyboard Shortcut Hint */}
        <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>
          キー操作: ◀ / ▶ 前後移動 • Space 選択切替 • Esc 閉じる
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import type { ImageItem, ItemDownloadState } from '@shared/types';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from './Icons';

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
    <div onClick={onClose} className="lightbox-backdrop">
      {/* Header Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--color-text-primary)',
          fontSize: 12,
          padding: '2px 4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="card-overlay-pill"
            style={{
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              padding: '3px 9px',
              borderRadius: 999,
              fontSize: 11,
            }}
          >
            {currentIndex + 1} / {items.length}
          </span>
          <span
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {dimsText} • {formatText}
          </span>
        </div>

        <button
          type="button"
          className="panel-control"
          onClick={onClose}
          aria-label="閉じる"
          style={{ minHeight: 28, width: 28, padding: 0, borderRadius: 999 }}
          title="閉じる (Esc)"
        >
          <CloseIcon size={14} />
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
            className="lightbox-nav-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            style={{ left: 2 }}
            aria-label="前の画像"
            title="前の画像 (←)"
          >
            <ChevronLeftIcon size={18} />
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
              if (
                naturalWidth > 0 &&
                naturalHeight > 0 &&
                (!activeVariant?.naturalWidth || !activeVariant?.naturalHeight)
              ) {
                onReportDimensions(currentItem.itemId, selectedUrl, naturalWidth, naturalHeight);
              }
            }}
            style={{
              maxWidth: '94%',
              maxHeight: 'calc(100vh - 180px)',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
            }}
          />
        </div>

        {/* Next Button */}
        {hasNext && (
          <button
            type="button"
            className="lightbox-nav-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            style={{ right: 2 }}
            aria-label="次の画像"
            title="次の画像 (→)"
          >
            <ChevronRightIcon size={18} />
          </button>
        )}
      </div>

      {/* Footer Controls */}
      <div onClick={(e) => e.stopPropagation()} className="lightbox-dock">
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
              gap: 7,
              cursor: onToggleSelect ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 600,
              color: checked ? 'var(--color-primary-text)' : 'var(--color-text-primary)',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!onToggleSelect}
              onChange={() => onToggleSelect?.(currentItem.itemId)}
              style={{ width: 15, height: 15, margin: 0 }}
            />
            <span>
              {checked ? '選択中' : onToggleSelect ? '選択する (Space)' : '寸法の確認が必要です'}
            </span>
          </label>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="card-action-btn variant-primary-solid"
              onClick={() => onDownload(currentItem.itemId)}
              style={{ padding: '5px 12px', fontSize: 11 }}
            >
              <DownloadIcon size={12} />
              <span>保存する</span>
            </button>

            <button
              type="button"
              className="card-action-btn variant-subtle"
              onClick={handleOpenOriginal}
              style={{ padding: '5px 10px', fontSize: 11 }}
              title="新しいタブで画像を開く"
            >
              <ExternalLinkIcon size={11} />
              <span>別タブで開く</span>
            </button>

            <button
              type="button"
              className={`card-action-btn ${copied ? 'variant-success' : 'variant-subtle'}`}
              onClick={handleCopyUrl}
              style={{ padding: '5px 10px', fontSize: 11 }}
              title="URLをコピー"
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              <span>{copied ? 'コピー完了' : 'URLコピー'}</span>
            </button>
          </div>
        </div>

        {/* Variant selector dropdown if multiple candidates exist */}
        {currentItem.variants.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>候補:</span>
            <select
              className="filter-select"
              value={selectedUrl}
              onChange={(e) => onSelectVariant(currentItem.itemId, e.target.value)}
              style={{ flex: 1, fontSize: 11, padding: '4px 7px' }}
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
                    {roleLabel} {desc} (
                    {v.naturalWidth ? `${v.naturalWidth}×${v.naturalHeight}` : v.format})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Keyboard Shortcut Hint */}
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          キー操作: ← / → 前後移動 • Space 選択切替 • Esc 閉じる
        </div>
      </div>
    </div>
  );
};

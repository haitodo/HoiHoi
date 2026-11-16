import React, { useState } from 'react';
import type { CardSize, ImageItem, ItemDownloadState } from '@shared/types';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  ExternalLinkIcon,
} from './Icons';

interface ImageCardProps {
  item: ImageItem;
  isSelected: boolean;
  canSelect: boolean;
  downloadState?: ItemDownloadState;
  thumbnailHeight?: number;
  cardSize?: CardSize;
  onToggleSelect: (e: React.MouseEvent) => void;
  onSelectVariant: (variantUrl: string) => void;
  onReportDimensions: (variantUrl: string, width: number, height: number) => void;
  onDownload: () => void;
  onOpenPreview?: () => void;
}

export const ImageCard: React.FC<ImageCardProps> = ({
  item,
  isSelected,
  canSelect,
  downloadState,
  thumbnailHeight = 120,
  cardSize = 'medium',
  onToggleSelect,
  onSelectVariant,
  onReportDimensions,
  onDownload,
  onOpenPreview,
}) => {
  const [imgError, setImgError] = useState(false);
  const [useThumbnailFallback, setUseThumbnailFallback] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeVariant =
    item.variants.find((v) => v.url === item.selectedUrl) || item.variants[0];
  const selectedUrl = item.selectedUrl;
  const thumbnailVariant =
    item.variants.find((variant) => variant.url === item.primaryUrl && !variant.largeDataRefId) ??
    item.variants.find(
      (variant) =>
        !variant.largeDataRefId &&
        variant.roles.some((role) => role === 'src' || role === 'current-src' || role === 'lazy-attr'),
    ) ??
    activeVariant;
  const previewUrl = useThumbnailFallback
    ? selectedUrl
    : (thumbnailVariant?.url ?? selectedUrl);
  const previewVariant = item.variants.find((variant) => variant.url === previewUrl);

  const handleCopyUrl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('Failed to copy URL:', err);
    }
  };

  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    chrome.tabs.create({ url: selectedUrl, active: false });
  };

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload();
  };

  const dimsText =
    activeVariant?.naturalWidth && activeVariant?.naturalHeight
      ? `${activeVariant.naturalWidth} × ${activeVariant.naturalHeight}`
      : '寸法不明';

  const formatText = activeVariant?.format.toUpperCase() || 'UNKNOWN';
  const checked = canSelect && isSelected;

  const downloadStatusClass =
    downloadState?.status === 'completed'
      ? 'status-completed'
      : downloadState?.status === 'in_progress' || downloadState?.status === 'starting'
        ? 'status-active'
        : downloadState?.status === 'failed'
          ? 'status-failed'
          : 'status-muted';

  return (
    <div
      className={`media-card ${canSelect ? 'is-selectable' : ''} ${checked ? 'is-selected' : ''}`}
      onClick={canSelect ? onToggleSelect : undefined}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenPreview?.();
      }}
    >
      {/* Selection Checkbox (Top Left) */}
      <div
        className="card-overlay-pill"
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 2,
          padding: '3px 4px',
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (canSelect) onToggleSelect(e);
        }}
        title={canSelect ? undefined : '「寸法取得」でサイズを確認するか、上部の「未確認も選択可」を有効にすると選択できます'}
      >
        <input
          type="checkbox"
          aria-label="ダウンロード対象として選択"
          checked={checked}
          disabled={!canSelect}
          onChange={() => {}}
          style={{ cursor: canSelect ? 'pointer' : 'default', margin: 0 }}
        />
      </div>

      {/* Quick Preview Button (Top Right) */}
      {onOpenPreview && (
        <button
          type="button"
          className="card-overlay-pill card-preview-btn"
          aria-label="拡大プレビュー"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPreview();
          }}
          style={{ right: item.occurrenceCount > 1 ? 38 : 6 }}
          title="クリックで拡大プレビューを開く（ダブルクリックでも可）"
        >
          <ExpandIcon size={11} />
        </button>
      )}

      {/* Occurrence Badge (Top Right) */}
      {item.occurrenceCount > 1 && (
        <span
          className="card-occurrence-badge"
          style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
          title={`ページ内で ${item.occurrenceCount} 箇所に出現`}
        >
          ×{item.occurrenceCount}
        </span>
      )}

      {/* Thumbnail Area */}
      <div
        style={{
          width: '100%',
          ...(cardSize === 'large'
            ? { minHeight: 160, maxHeight: thumbnailHeight }
            : { height: thumbnailHeight }),
          backgroundColor: 'var(--color-thumb-bg)',
          borderBottom: '1px solid var(--color-border)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {imgError ? (
          <div
            style={{
              padding: 8,
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 10,
              wordBreak: 'break-all',
            }}
          >
            <div>プレビュー不可</div>
            <div style={{ fontSize: 9, marginTop: 2 }}>{selectedUrl.slice(0, 40)}...</div>
          </div>
        ) : (
          <img
            src={previewUrl}
            alt="Thumbnail"
            loading="lazy"
            onError={() => {
              if (!useThumbnailFallback && previewUrl !== selectedUrl) {
                setUseThumbnailFallback(true);
              } else {
                setImgError(true);
              }
            }}
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              if (
                naturalWidth > 0 &&
                naturalHeight > 0 &&
                (!previewVariant?.naturalWidth || !previewVariant?.naturalHeight)
              ) {
                onReportDimensions(previewUrl, naturalWidth, naturalHeight);
              }
            }}
            style={
              cardSize === 'large'
                ? {
                    width: '100%',
                    height: 'auto',
                    maxHeight: thumbnailHeight,
                    objectFit: 'contain',
                    display: 'block',
                    ...(previewVariant?.naturalWidth && previewVariant?.naturalHeight
                      ? { aspectRatio: `${previewVariant.naturalWidth} / ${previewVariant.naturalHeight}` }
                      : {}),
                  }
                : {
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }
            }
          />
        )}

        {/* Download Status Badge (Anchored cleanly inside thumbnail stage) */}
        {downloadState && downloadState.status !== 'idle' && (
          <div className={`card-download-pill ${downloadStatusClass}`}>
            {downloadState.status === 'completed' && '保存完了'}
            {downloadState.status === 'in_progress' && 'ダウンロード中'}
            {downloadState.status === 'starting' && '開始処理中'}
            {downloadState.status === 'queued' && '待機中'}
            {downloadState.status === 'failed' && (downloadState.errorMessage || '保存失敗')}
            {downloadState.status === 'canceled' && 'キャンセル'}
          </div>
        )}
      </div>

      {/* Card Info and Actions */}
      <div
        style={{
          padding: cardSize === 'small' ? '5px 6px' : '7px 8px',
          fontSize: 11,
          backgroundColor: 'var(--color-card-bg)',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'space-between',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <div>
          {/* Dimensions & Format */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: cardSize === 'small' ? 9 : 10,
              fontVariantNumeric: 'tabular-nums',
              marginBottom: 5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              lineHeight: 1.2,
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={dimsText}
            >
              {dimsText}
            </span>
            <span
              style={{
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.03em',
                marginLeft: 4,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {formatText}
            </span>
          </div>

          {/* Variant selector dropdown if item has multiple candidates */}
          {item.variants.length > 1 && (
            <div style={{ marginBottom: 5 }} onClick={(e) => e.stopPropagation()}>
              <select
                className="card-variant-select"
                value={selectedUrl}
                onChange={(e) => onSelectVariant(e.target.value)}
                style={{ fontSize: cardSize === 'small' ? 9 : 10 }}
              >
                {item.variants.map((v, idx) => {
                  const desc = v.descriptors.length > 0 ? ` (${v.descriptors.join(', ')})` : '';
                  const roleLabel = v.roles.includes('link-target')
                    ? '高解像度'
                    : v.roles.includes('current-src')
                      ? '表示画像'
                      : `候補 ${idx + 1}`;
                  return (
                    <option key={v.url} value={v.url}>
                      {roleLabel}
                      {desc}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: cardSize === 'small' ? 3 : 4,
            alignItems: 'center',
            marginTop: 'auto',
            flexWrap: 'nowrap',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          {cardSize === 'small' ? (
            <>
              <button
                type="button"
                className="card-action-btn variant-primary-tint"
                onClick={handleDownloadClick}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '3px 4px',
                  fontSize: 10,
                  lineHeight: 1.2,
                }}
                title="この画像を保存"
              >
                <DownloadIcon size={10} />
                <span>保存</span>
              </button>

              <button
                type="button"
                className="card-action-btn variant-subtle"
                onClick={handleOpenOriginal}
                style={{ flexShrink: 0, padding: '3px 5px', fontSize: 10, lineHeight: 1.2 }}
                aria-label="新しいタブで画像を開く"
                title="新しいタブで画像を開く"
              >
                <ExternalLinkIcon size={10} />
              </button>
            </>
          ) : cardSize === 'large' ? (
            <>
              <button
                type="button"
                className="card-action-btn variant-primary-tint"
                onClick={handleDownloadClick}
                style={{ flex: 1.2, minWidth: 0, padding: '5px 8px', fontSize: 11 }}
                title="この画像を保存"
              >
                <DownloadIcon size={12} />
                <span>保存</span>
              </button>

              {onOpenPreview && (
                <button
                  type="button"
                  className="card-action-btn variant-subtle"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPreview();
                  }}
                  style={{ flexShrink: 0, padding: '5px 8px', fontSize: 11 }}
                  title="拡大プレビュー（前後の送り確認も可能）"
                >
                  <ExpandIcon size={11} />
                  <span>拡大</span>
                </button>
              )}

              <button
                type="button"
                className="card-action-btn variant-subtle"
                onClick={handleOpenOriginal}
                style={{ flexShrink: 0, padding: '5px 8px', fontSize: 11 }}
                title="新しいタブで画像を開く"
              >
                別タブ
              </button>

              <button
                type="button"
                className={`card-action-btn ${copied ? 'variant-success' : 'variant-subtle'}`}
                onClick={handleCopyUrl}
                style={{ flexShrink: 0, padding: '5px 8px', fontSize: 11 }}
                title="画像URLをクリップボードにコピー"
              >
                {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
                <span>{copied ? 'コピー済' : 'コピー'}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="card-action-btn variant-primary-tint"
                onClick={handleDownloadClick}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '4px 5px',
                  fontSize: 10,
                  lineHeight: 1.2,
                }}
                title="この画像を保存"
              >
                <DownloadIcon size={10} />
                <span>保存</span>
              </button>

              <button
                type="button"
                className="card-action-btn variant-subtle"
                onClick={handleOpenOriginal}
                style={{ flexShrink: 0, padding: '4px 6px', fontSize: 10, lineHeight: 1.2 }}
                title="新しいタブで画像を開く"
              >
                開く
              </button>

              <button
                type="button"
                className={`card-action-btn ${copied ? 'variant-success' : 'variant-subtle'}`}
                onClick={handleCopyUrl}
                style={{ flexShrink: 0, padding: '4px 6px', fontSize: 10, lineHeight: 1.2 }}
                title="画像URLをクリップボードにコピー"
              >
                {copied ? '済' : 'コピー'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import type { CardSize, ImageItem, ItemDownloadState } from '@shared/types';

interface ImageCardProps {
  item: ImageItem;
  isSelected: boolean;
  downloadState?: ItemDownloadState;
  thumbnailHeight?: number;
  cardSize?: CardSize;
  onToggleSelect: () => void;
  onSelectVariant: (variantUrl: string) => void;
  onReportDimensions: (variantUrl: string, width: number, height: number) => void;
  onDownload: () => void;
  onOpenPreview?: () => void;
}

export const ImageCard: React.FC<ImageCardProps> = ({
  item,
  isSelected,
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
  const previewUrl = useThumbnailFallback
    ? (item.primaryUrl || selectedUrl)
    : selectedUrl;

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

  return (
    <div
      onClick={onToggleSelect}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenPreview?.();
      }}
      style={{
        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 8,
        backgroundColor: 'var(--color-card-bg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
        cursor: 'pointer',
        position: 'relative',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Selection Checkbox (Top Left) */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 2,
          backgroundColor: 'var(--color-overlay-bg)',
          border: '1px solid var(--color-overlay-border)',
          borderRadius: 4,
          padding: '2px 4px',
          display: 'flex',
          alignItems: 'center',
          backdropFilter: 'blur(4px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          style={{ cursor: 'pointer', margin: 0 }}
        />
      </div>

      {/* Quick Preview Button (Top Right) */}
      {onOpenPreview && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPreview();
          }}
          style={{
            position: 'absolute',
            top: 6,
            right: item.occurrenceCount > 1 ? 38 : 6,
            zIndex: 3,
            backgroundColor: 'var(--color-overlay-bg)',
            border: '1px solid var(--color-overlay-border)',
            color: 'var(--color-text-primary)',
            borderRadius: 4,
            padding: '2px 5px',
            fontSize: 10,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
            backdropFilter: 'blur(4px)',
          }}
          title="クリックで拡大プレビューを開く（ダブルクリックでも可）"
        >
          🔍
        </button>
      )}

      {/* Occurrence Badge (Top Right) */}
      {item.occurrenceCount > 1 && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            zIndex: 2,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#ffffff',
            fontSize: 10,
            padding: '1px 5px',
            borderRadius: 8,
            fontWeight: 500,
          }}
          title={`ページ内で ${item.occurrenceCount} 箇所に出現`}
        >
          ×{item.occurrenceCount}
        </span>
      )}

      {/* Download Status Badge */}
      {downloadState && downloadState.status !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 6,
            right: 6,
            zIndex: 2,
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 10,
            textAlign: 'center',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor:
              downloadState.status === 'completed'
                ? '#10b981'
                : downloadState.status === 'in_progress' || downloadState.status === 'starting'
                  ? '#3b82f6'
                  : downloadState.status === 'failed'
                    ? '#ef4444'
                    : '#6b7280',
          }}
        >
          {downloadState.status === 'completed' && '保存完了'}
          {downloadState.status === 'in_progress' && 'ダウンロード中'}
          {downloadState.status === 'starting' && '開始処理中'}
          {downloadState.status === 'queued' && '待機中'}
          {downloadState.status === 'failed' && (downloadState.errorMessage || '保存失敗')}
          {downloadState.status === 'canceled' && 'キャンセル'}
        </div>
      )}

      {/* Thumbnail Area */}
      <div
        style={{
          width: '100%',
          height: thumbnailHeight,
          backgroundColor: 'var(--color-thumb-bg)',
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
              if (!useThumbnailFallback && item.primaryUrl && item.primaryUrl !== selectedUrl) {
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
                (!activeVariant?.naturalWidth || !activeVariant?.naturalHeight)
              ) {
                onReportDimensions(selectedUrl, naturalWidth, naturalHeight);
              }
            }}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        )}
      </div>

      {/* Card Info and Actions */}
      <div
        style={{
          padding: cardSize === 'small' ? '4px 6px' : '6px 8px',
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
              color: 'var(--color-text-muted)',
              fontSize: cardSize === 'small' ? 9 : 10,
              marginBottom: 4,
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
                color: 'var(--color-text-primary)',
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
            <div style={{ marginBottom: 4 }} onClick={(e) => e.stopPropagation()}>
              <select
                value={selectedUrl}
                onChange={(e) => onSelectVariant(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: cardSize === 'small' ? 9 : 10,
                  padding: '1px 3px',
                  border: '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  backgroundColor: 'var(--color-bg-surface)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
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
            // Small mode: 2 compact buttons to prevent text wrapping and vertical expansion
            <>
              <button
                type="button"
                onClick={handleDownloadClick}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '3px 2px',
                  fontSize: 10,
                  backgroundColor: 'var(--color-primary-subtle)',
                  color: 'var(--color-primary-text)',
                  border: '1px solid var(--color-primary-subtle-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
                title="この画像を保存"
              >
                保存
              </button>

              <button
                type="button"
                onClick={handleOpenOriginal}
                style={{
                  flexShrink: 0,
                  padding: '3px 6px',
                  fontSize: 10,
                  backgroundColor: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
                title="新しいタブで画像を開く"
              >
                ↗
              </button>
            </>
          ) : cardSize === 'large' ? (
            // Large mode: Spacious bar with all 4 actions labeled
            <>
              <button
                type="button"
                onClick={handleDownloadClick}
                style={{
                  flex: 1.2,
                  minWidth: 0,
                  padding: '5px 8px',
                  fontSize: 11,
                  backgroundColor: 'var(--color-primary-subtle)',
                  color: 'var(--color-primary-text)',
                  border: '1px solid var(--color-primary-subtle-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title="この画像を保存"
              >
                💾 保存
              </button>

              {onOpenPreview && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPreview();
                  }}
                  style={{
                    flexShrink: 0,
                    padding: '5px 8px',
                    fontSize: 11,
                    backgroundColor: 'var(--color-bg-subtle)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-input)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="拡大プレビュー（前後の送り確認も可能）"
                >
                  🔍 拡大
                </button>
              )}

              <button
                type="button"
                onClick={handleOpenOriginal}
                style={{
                  flexShrink: 0,
                  padding: '5px 8px',
                  fontSize: 11,
                  backgroundColor: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="新しいタブで画像を開く"
              >
                別タブ
              </button>

              <button
                type="button"
                onClick={handleCopyUrl}
                style={{
                  flexShrink: 0,
                  padding: '5px 8px',
                  fontSize: 11,
                  backgroundColor: copied
                    ? 'var(--color-success-subtle)'
                    : 'var(--color-bg-subtle)',
                  color: copied
                    ? 'var(--color-success-text)'
                    : 'var(--color-text-primary)',
                  border: copied
                    ? '1px solid var(--color-success-border)'
                    : '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title="画像URLをクリップボードにコピー"
              >
                {copied ? 'コピー済' : 'コピー'}
              </button>
            </>
          ) : (
            // Medium / Auto mode: Clean 3-button layout (Preview is in top-right 🔍)
            <>
              <button
                type="button"
                onClick={handleDownloadClick}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '3px 4px',
                  fontSize: 10,
                  backgroundColor: 'var(--color-primary-subtle)',
                  color: 'var(--color-primary-text)',
                  border: '1px solid var(--color-primary-subtle-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
                title="この画像を保存"
              >
                保存
              </button>

              <button
                type="button"
                onClick={handleOpenOriginal}
                style={{
                  flexShrink: 0,
                  padding: '3px 6px',
                  fontSize: 10,
                  backgroundColor: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
                title="新しいタブで画像を開く"
              >
                開く
              </button>

              <button
                type="button"
                onClick={handleCopyUrl}
                style={{
                  flexShrink: 0,
                  padding: '3px 6px',
                  fontSize: 10,
                  backgroundColor: copied
                    ? 'var(--color-success-subtle)'
                    : 'var(--color-bg-subtle)',
                  color: copied
                    ? 'var(--color-success-text)'
                    : 'var(--color-text-primary)',
                  border: copied
                    ? '1px solid var(--color-success-border)'
                    : '1px solid var(--color-border-input)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
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

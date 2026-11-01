import React, { useState } from 'react';
import type { ImageItem, ItemDownloadState } from '@shared/types';

interface ImageCardProps {
  item: ImageItem;
  isSelected: boolean;
  downloadState?: ItemDownloadState;
  onToggleSelect: () => void;
  onSelectVariant: (variantUrl: string) => void;
  onReportDimensions: (variantUrl: string, width: number, height: number) => void;
  onDownload: () => void;
}

export const ImageCard: React.FC<ImageCardProps> = ({
  item,
  isSelected,
  downloadState,
  onToggleSelect,
  onSelectVariant,
  onReportDimensions,
  onDownload,
}) => {
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeVariant =
    item.variants.find((v) => v.url === item.selectedUrl) || item.variants[0];
  const selectedUrl = item.selectedUrl;

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
      style={{
        border: `2px solid ${isSelected ? '#4f46e5' : '#e5e7eb'}`,
        borderRadius: 8,
        backgroundColor: '#ffffff',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
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
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          borderRadius: 4,
          padding: '2px 4px',
          display: 'flex',
          alignItems: 'center',
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
          height: 120,
          backgroundColor: '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {imgError ? (
          <div
            style={{
              padding: 8,
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: 10,
              wordBreak: 'break-all',
            }}
          >
            <div>プレビュー不可</div>
            <div style={{ fontSize: 9, marginTop: 2 }}>{selectedUrl.slice(0, 40)}...</div>
          </div>
        ) : (
          <img
            src={selectedUrl}
            alt="Thumbnail"
            loading="lazy"
            onError={() => setImgError(true)}
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
      <div style={{ padding: '6px 8px', fontSize: 11, backgroundColor: '#ffffff' }}>
        {/* Dimensions & Format */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: '#4b5563',
            fontSize: 10,
            marginBottom: 4,
          }}
        >
          <span>{dimsText}</span>
          <span style={{ fontWeight: 600 }}>{formatText}</span>
        </div>

        {/* Variant selector dropdown if item has multiple candidates */}
        {item.variants.length > 1 && (
          <div style={{ marginBottom: 6 }} onClick={(e) => e.stopPropagation()}>
            <select
              value={selectedUrl}
              onChange={(e) => onSelectVariant(e.target.value)}
              style={{
                width: '100%',
                fontSize: 10,
                padding: '2px 4px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
              }}
            >
              {item.variants.map((v, idx) => {
                const desc = v.descriptors.length > 0 ? ` (${v.descriptors.join(', ')})` : '';
                const roleLabel = v.roles.includes('link-target')
                  ? 'リンク先'
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

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={handleDownloadClick}
            style={{
              flex: 1,
              padding: '2px 4px',
              fontSize: 10,
              backgroundColor: '#eef2ff',
              color: '#4338ca',
              border: '1px solid #c7d2fe',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="この画像を保存"
          >
            保存
          </button>

          <button
            type="button"
            onClick={handleOpenOriginal}
            style={{
              padding: '2px 6px',
              fontSize: 10,
              backgroundColor: '#f3f4f6',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title="新しいタブで画像を開く"
          >
            開く
          </button>

          <button
            type="button"
            onClick={handleCopyUrl}
            style={{
              padding: '2px 6px',
              fontSize: 10,
              backgroundColor: copied ? '#dcfce7' : '#f3f4f6',
              color: copied ? '#166534' : '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            title="画像URLをクリップボードにコピー"
          >
            {copied ? '済' : 'コピー'}
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import type {
  VideoDurationRange,
  VideoFilterState,
  VideoFormat,
  VideoResolutionTier,
  VideoSortOrder,
} from '@shared/types';

interface VideoFilterBarProps {
  filter: VideoFilterState;
  onChange: (next: VideoFilterState) => void;
  sortOrder: VideoSortOrder;
  onSortChange: (order: VideoSortOrder) => void;
  onReset?: () => void;
  unknownMetadataCount: number;
}

const AVAILABLE_VIDEO_FORMATS: Array<{ label: string; value: VideoFormat }> = [
  { label: 'MP4', value: 'mp4' },
  { label: 'WebM', value: 'webm' },
  { label: 'MOV', value: 'mov' },
  { label: 'HLS (.m3u8)', value: 'hls' },
  { label: 'DASH', value: 'dash' },
  { label: '不明', value: 'unknown' },
];

export const VideoFilterBar: React.FC<VideoFilterBarProps> = ({
  filter,
  onChange,
  sortOrder,
  onSortChange,
  onReset,
  unknownMetadataCount,
}) => {
  const toggleFormat = (fmt: VideoFormat) => {
    const isSelected = filter.formats.includes(fmt);
    const nextFormats = isSelected
      ? filter.formats.filter((f) => f !== fmt)
      : [...filter.formats, fmt];
    onChange({ ...filter, formats: nextFormats });
  };

  const hasMetadataFilter =
    filter.minResolution !== 'all' ||
    filter.durationRange !== 'all' ||
    (filter.minDurationSec ?? 0) > 0;

  const isFilterActive = Boolean(
    filter.urlQuery ||
      hasMetadataFilter ||
      filter.formats.length > 0 ||
      filter.onlyReadyToDownload ||
      filter.includeUnknownMetadata,
  );

  return (
    <div
      style={{
        padding: '10px 14px',
        backgroundColor: 'var(--color-bg-subtle)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Search Input */}
      <div>
        <input
          type="text"
          placeholder="動画URL・ファイル名で絞り込み..."
          value={filter.urlQuery}
          onChange={(e) => onChange({ ...filter, urlQuery: e.target.value })}
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: 12,
            border: '1px solid var(--color-border-input)',
            borderRadius: 6,
            boxSizing: 'border-box',
            backgroundColor: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>

      {/* Resolution, Duration & Sort Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 95px' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            画質:
          </span>
          <select
            value={filter.minResolution}
            onChange={(e) =>
              onChange({
                ...filter,
                minResolution: e.target.value as VideoResolutionTier,
              })
            }
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid var(--color-border-input)',
              borderRadius: 4,
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="all">すべて</option>
            <option value="4k">4K (2160p+)</option>
            <option value="1080p">FHD (1080p+)</option>
            <option value="720p">HD (720p+)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 100px' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            長さ:
          </span>
          <select
            value={filter.durationRange}
            onChange={(e) =>
              onChange({
                ...filter,
                durationRange: e.target.value as VideoDurationRange,
              })
            }
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid var(--color-border-input)',
              borderRadius: 4,
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="all">すべて</option>
            <option value="short">ショート (&lt;1分)</option>
            <option value="medium">中尺 (1〜10分)</option>
            <option value="long">長尺 (10分+)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1.2 1 125px' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            並び順:
          </span>
          <select
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as VideoSortOrder)}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid var(--color-border-input)',
              borderRadius: 4,
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            <option value="position_asc">配置順 (上から下)</option>
            <option value="position_desc">配置順 (下から上)</option>
            <option value="resolution_desc">解像度 (高い順)</option>
            <option value="resolution_asc">解像度 (低い順)</option>
            <option value="duration_desc">長さ (長い順)</option>
            <option value="duration_asc">長さ (短い順)</option>
            <option value="filesize_desc">サイズ (大きい順)</option>
            <option value="filename_asc">ファイル名 (A-Z)</option>
            <option value="selected_first">選択中を先頭</option>
          </select>
        </div>
      </div>

      {/* Format Chips, Ready-Only Toggle & Reset */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {AVAILABLE_VIDEO_FORMATS.map((f) => {
            const selected = filter.formats.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFormat(f.value)}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 12,
                  border: '1px solid',
                  borderColor: selected ? 'var(--color-primary)' : 'var(--color-border-input)',
                  backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                  color: selected ? '#ffffff' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontWeight: selected ? 600 : 400,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            title="ストリーミング配信 (.m3u8) や保護ストリームを非表示にし、直接ファイル保存できる動画のみ表示します"
          >
            <input
              type="checkbox"
              checked={filter.onlyReadyToDownload}
              onChange={(e) =>
                onChange({ ...filter, onlyReadyToDownload: e.target.checked })
              }
              style={{ margin: 0, cursor: 'pointer' }}
            />
            直接保存可のみ
          </label>

          {isFilterActive && onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{
                fontSize: 11,
                color: 'var(--color-primary-text)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 4px',
                textDecoration: 'underline',
              }}
            >
              リセット
            </button>
          )}
        </div>
      </div>

      {/* Unprobed metadata banner (Zero-Eager-Load transparency) */}
      {hasMetadataFilter && unknownMetadataCount > 0 && (
        <div
          style={{
            fontSize: 11,
            padding: '5px 8px',
            borderRadius: 5,
            backgroundColor: 'var(--color-warning-subtle)',
            border: '1px solid var(--color-warning-border)',
            color: 'var(--color-warning-banner-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <span>
            {filter.includeUnknownMetadata
              ? `再生前のため画質・長さ未取得の動画 ${unknownMetadataCount} 件も表示中`
              : `再生前のため画質・長さ未取得の動画が ${unknownMetadataCount} 件非表示です`}
          </span>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={filter.includeUnknownMetadata}
              onChange={(e) =>
                onChange({ ...filter, includeUnknownMetadata: e.target.checked })
              }
            />
            未取得も表示
          </label>
        </div>
      )}
    </div>
  );
};

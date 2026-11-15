import React from 'react';
import type {
  VideoDurationRange,
  VideoFilterState,
  VideoFormat,
  VideoResolutionTier,
  VideoSortOrder,
} from '@shared/types';
import { SearchIcon } from './Icons';

interface VideoFilterBarProps {
  filter: VideoFilterState;
  onChange: (next: VideoFilterState) => void;
  sortOrder: VideoSortOrder;
  onSortChange: (order: VideoSortOrder) => void;
  onReset?: () => void;
  unknownMetadataCount: number;
  unprobedCount?: number;
  isProbing?: boolean;
  onStartProbing?: () => void;
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
  unprobedCount = 0,
  isProbing = false,
  onStartProbing,
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
    <div className="filter-section">
      {/* Search Input */}
      <div>
        <input
          type="text"
          className="filter-input"
          aria-label="動画URL・ファイル名で絞り込み"
          placeholder="動画URL・ファイル名で絞り込み..."
          value={filter.urlQuery}
          onChange={(e) => onChange({ ...filter, urlQuery: e.target.value })}
        />
      </div>

      {/* Resolution, Duration & Sort Controls */}
      <div className="filter-row">
        <div className="filter-field" style={{ flex: '1 1 95px' }}>
          <span className="filter-field-label">画質:</span>
          <select
            className="filter-select"
            aria-label="画質"
            value={filter.minResolution}
            onChange={(e) =>
              onChange({
                ...filter,
                minResolution: e.target.value as VideoResolutionTier,
              })
            }
          >
            <option value="all">すべて</option>
            <option value="4k">4K (2160p+)</option>
            <option value="1080p">FHD (1080p+)</option>
            <option value="720p">HD (720p+)</option>
          </select>
        </div>

        <div className="filter-field" style={{ flex: '1 1 100px' }}>
          <span className="filter-field-label">長さ:</span>
          <select
            className="filter-select"
            aria-label="長さ"
            value={filter.durationRange}
            onChange={(e) =>
              onChange({
                ...filter,
                durationRange: e.target.value as VideoDurationRange,
              })
            }
          >
            <option value="all">すべて</option>
            <option value="short">ショート (&lt;1分)</option>
            <option value="medium">中尺 (1〜10分)</option>
            <option value="long">長尺 (10分+)</option>
          </select>
        </div>

        <div className="filter-field" style={{ flex: '1.2 1 125px' }}>
          <span className="filter-field-label">並び順:</span>
          <select
            className="filter-select"
            aria-label="並び順"
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as VideoSortOrder)}
            style={{ fontWeight: 500 }}
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
        <div className="filter-chips">
          {AVAILABLE_VIDEO_FORMATS.map((f) => {
            const selected = filter.formats.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                className={`filter-chip ${selected ? 'is-selected' : ''}`}
                onClick={() => toggleFormat(f.value)}
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
              className="filter-link-btn"
              style={{ color: 'var(--color-primary-text)' }}
              onClick={onReset}
            >
              リセット
            </button>
          )}
        </div>
      </div>

      {!isProbing && unprobedCount > 0 && onStartProbing && (
        <div className="filter-probe-banner">
          <span style={{ color: 'var(--color-text-secondary)' }}>
            画質未取得の直接保存動画: {unprobedCount} 件
          </span>
          <button
            type="button"
            className="card-action-btn variant-primary-tint"
            onClick={onStartProbing}
            style={{ padding: '2px 8px', fontSize: 11 }}
            title="動画全体をダウンロードせず、先頭メタデータのみを1件ずつ軽量に問い合わせて解像度を取得します"
          >
            <SearchIcon size={11} />
            <span>画質を一括取得</span>
          </button>
        </div>
      )}

      {/* Unprobed metadata banner (Zero-Eager-Load transparency) */}
      {hasMetadataFilter && unknownMetadataCount > 0 && (
        <div className="filter-warning-banner">
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

export function VideoProbeStatus({
  progress,
  onStop,
}: {
  progress: { current: number; total: number } | null;
  onStop: () => void;
}) {
  return (
    <div className="scan-toolbar">
      <div className="scan-running-bar">
        <span className="scan-running-info" role="status">
          画質・長さを計測中… ({progress?.current ?? 0} / {progress?.total ?? 0})
        </span>
        <button type="button" className="scan-stop-btn" onClick={onStop}>
          中止
        </button>
      </div>
    </div>
  );
}

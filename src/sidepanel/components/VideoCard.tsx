import React, { useEffect, useRef, useState } from 'react';
import { extractFilenameForSort } from '@shared/filename-utils';
import type { CardSize, ItemDownloadState, VideoItem } from '@shared/types';
import {
  buildStreamCliCommand,
  extractResolutionHint,
  formatByteSize,
  formatVideoDuration,
  getActiveVideoVariant,
  getVideoResolutionTier,
  getVideoResolutionTierFromVariant,
} from '@shared/video-utils';
import type { HlsStreamMergeProgress } from '../utils/hls-saver';

interface VideoCardProps {
  item: VideoItem;
  isSelected: boolean;
  isInlinePlaying: boolean;
  downloadState?: ItemDownloadState;
  thumbnailHeight?: number;
  cardSize?: CardSize;
  onToggleSelect: () => void;
  onToggleInlinePlay: () => void;
  onSelectVariant: (variantUrl: string) => void;
  onReportVideoMetadata: (
    variantUrl: string,
    width: number | null,
    height: number | null,
    durationSec: number | null,
  ) => void;
  onResolveHlsManifest: (manifestUrl: string) => Promise<void>;
  onMergeHlsStream?: (
    manifestUrl: string,
    signal: AbortSignal,
    onProgress: (progress: HlsStreamMergeProgress) => void,
  ) => Promise<void>;
  onDownload: () => void;
  onCancelDownload: () => void;
  onOpenPreview?: () => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  item,
  isSelected,
  isInlinePlaying,
  downloadState,
  thumbnailHeight = 148,
  onToggleSelect,
  onToggleInlinePlay,
  onSelectVariant,
  onReportVideoMetadata,
  onResolveHlsManifest,
  onMergeHlsStream,
  onDownload,
  onCancelDownload,
  onOpenPreview,
}) => {
  const [posterError, setPosterError] = useState(false);
  const [copiedType, setCopiedType] = useState<'url' | 'cmd' | null>(null);
  const [resolvingHls, setResolvingHls] = useState(false);
  const [hlsMergeProgress, setHlsMergeProgress] = useState<HlsStreamMergeProgress | null>(null);
  const [hlsMergeError, setHlsMergeError] = useState<string | null>(null);
  const hlsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      hlsAbortRef.current?.abort();
    };
  }, []);

  const activeVariant = getActiveVideoVariant(item.variants, item.selectedUrl);
  const selectedUrl = item.selectedUrl;
  const readiness = activeVariant?.readiness ?? 'blocked';
  const canSelect = readiness === 'ready';
  const canPreviewInline =
    readiness === 'ready' && !selectedUrl.startsWith('data:__WIC_LARGE');

  const resTier = getVideoResolutionTierFromVariant(activeVariant);
  const detectedHint =
    !activeVariant?.videoWidth || !activeVariant?.videoHeight
      ? (activeVariant?.descriptors[0] ? extractResolutionHint(activeVariant.descriptors[0]) : null) ??
        extractResolutionHint(selectedUrl)
      : null;

  const resBadge =
    resTier !== 'unknown'
      ? resTier === '4k'
        ? '4K'
        : resTier.toUpperCase()
      : activeVariant?.descriptors[0] || (detectedHint ? detectedHint.descriptor : null);

  const dimsText =
    activeVariant?.videoWidth && activeVariant?.videoHeight
      ? `${activeVariant.videoWidth}×${activeVariant.videoHeight}`
      : activeVariant?.descriptors[0]
        ? activeVariant.descriptors[0]
        : detectedHint
          ? `${detectedHint.descriptor} (推定)`
          : '画質未取得';

  const formatText = (activeVariant?.format || 'unknown').toUpperCase();
  const sizeText = formatByteSize(activeVariant?.fileSizeBytes);
  const durationText = formatVideoDuration(item.durationSec, item.isLive);
  const displayBasename = extractFilenameForSort(selectedUrl) || 'video';

  const isDownloading =
    downloadState?.status === 'queued' ||
    downloadState?.status === 'starting' ||
    downloadState?.status === 'in_progress';

  const progressPercent =
    downloadState?.status === 'in_progress' &&
    downloadState.totalBytes &&
    downloadState.totalBytes > 0 &&
    downloadState.bytesReceived !== undefined
      ? Math.min(100, Math.round((downloadState.bytesReceived / downloadState.totalBytes) * 100))
      : null;

  const handleCardClick = () => {
    if (canSelect) {
      onToggleSelect();
    }
  };

  const handleCopyUrl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopiedType('url');
      setTimeout(() => setCopiedType(null), 1500);
    } catch {}
  };

  const handleCopyCliCommand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const stem = displayBasename.replace(/\.[^.]+$/, '') || 'stream_video';
      const cmd = buildStreamCliCommand('yt-dlp', selectedUrl, stem);
      await navigator.clipboard.writeText(cmd);
      setCopiedType('cmd');
      setTimeout(() => setCopiedType(null), 1800);
    } catch {}
  };

  const handleResolveHlsClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resolvingHls) return;
    setResolvingHls(true);
    try {
      await onResolveHlsManifest(selectedUrl);
    } finally {
      setResolvingHls(false);
    }
  };

  const handleMergeHlsClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onMergeHlsStream || hlsMergeProgress !== null) return;

    const controller = new AbortController();
    hlsAbortRef.current = controller;
    setHlsMergeError(null);
    setHlsMergeProgress({ completedSegments: 0, totalSegments: 0, bytesReceived: 0 });

    try {
      await onMergeHlsStream(selectedUrl, controller.signal, (progress) => {
        setHlsMergeProgress(progress);
      });
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') || controller.signal.aborted;
      if (!isAbort) {
        setHlsMergeError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (hlsAbortRef.current === controller) {
        hlsAbortRef.current = null;
      }
      setHlsMergeProgress(null);
    }
  };

  const handleCancelHlsMerge = (e: React.MouseEvent) => {
    e.stopPropagation();
    hlsAbortRef.current?.abort();
  };

  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    chrome.tabs.create({ url: selectedUrl, active: false });
  };

  return (
    <div
      onClick={handleCardClick}
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
        cursor: canSelect ? 'pointer' : 'default',
        position: 'relative',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Top-Left Selection Checkbox or Status Pill */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 3,
          backgroundColor: 'var(--color-overlay-bg)',
          border: '1px solid var(--color-overlay-border)',
          borderRadius: 4,
          padding: '2px 5px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          backdropFilter: 'blur(4px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {canSelect ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            style={{ cursor: 'pointer', margin: 0 }}
            title="ダウンロード対象として選択"
          />
        ) : readiness === 'stream_manifest' ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--color-info-text)',
            }}
            title={activeVariant?.blockReason}
          >
            STREAM
          </span>
        ) : (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--color-danger-text)',
            }}
            title={activeVariant?.blockReason}
          >
            保存不可
          </span>
        )}
      </div>

      {/* Top-Right Controls: Expand Modal & Occurrence Badge */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {onOpenPreview && canPreviewInline && (
          <button
            type="button"
            onClick={() => onOpenPreview()}
            style={{
              backgroundColor: 'var(--color-overlay-bg)',
              border: '1px solid var(--color-overlay-border)',
              color: 'var(--color-text-primary)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
            title="拡大プレイヤーで開く"
          >
            🔍
          </button>
        )}

        {item.occurrenceCount > 1 && (
          <span
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.72)',
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
      </div>

      {/* 16:9 Stage: Strictly Static Poster UNLESS User Explicitly Clicked Play */}
      <div
        style={{
          width: '100%',
          height: thumbnailHeight,
          backgroundColor: '#0f172a',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {isInlinePlaying ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', height: '100%', position: 'relative' }}
          >
            <video
              src={selectedUrl}
              poster={item.posterUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const dur =
                  Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
                onReportVideoMetadata(
                  selectedUrl,
                  v.videoWidth > 0 ? v.videoWidth : null,
                  v.videoHeight > 0 ? v.videoHeight : null,
                  dur,
                );
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                backgroundColor: '#000000',
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleInlinePlay();
              }}
              style={{
                position: 'absolute',
                top: 32,
                right: 6,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 10,
                cursor: 'pointer',
              }}
              title="プレビュー再生を閉じて通信を停止"
            >
              ⏹ 閉じる
            </button>
          </div>
        ) : (
          <>
            {item.posterUrl && !posterError ? (
              <img
                src={item.posterUrl}
                alt="Video Poster"
                loading="lazy"
                onError={() => setPosterError(true)}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  padding: '10px 14px',
                  textAlign: 'center',
                  color: '#cbd5e1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  maxWidth: '90%',
                }}
              >
                <span style={{ fontSize: 22, opacity: 0.85 }}>🎬</span>
                <span
                  style={{
                    fontSize: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    opacity: 0.9,
                  }}
                >
                  {displayBasename}
                </span>
              </div>
            )}

            {/* Explicit Click-to-Preview Play Button (Zero Auto-Buffering!) */}
            {canPreviewInline && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleInlinePlay();
                }}
                style={{
                  position: 'absolute',
                  backgroundColor: 'rgba(15, 23, 42, 0.78)',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: 20,
                  padding: '5px 11px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
                  backdropFilter: 'blur(3px)',
                }}
                title="クリックした時だけ動画を読み込んでプレビュー再生します"
              >
                ▶ プレビュー
              </button>
            )}

            {/* Bottom-Left Format / Resolution Badge */}
            <div
              style={{
                position: 'absolute',
                bottom: 6,
                left: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.75)',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                {resBadge ? `${resBadge} • ${formatText}` : formatText}
              </span>
            </div>

            {/* Bottom-Right Duration Badge */}
            {(item.durationSec || item.isLive) && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 6,
                  right: 6,
                  backgroundColor: item.isLive ? '#dc2626' : 'rgba(0, 0, 0, 0.78)',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 4,
                }}
              >
                {durationText}
              </span>
            )}
          </>
        )}
      </div>

      {/* Metadata & Action Body */}
      <div
        style={{
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
          justifyContent: 'space-between',
          fontSize: 11,
        }}
      >
        {/* Dimensions, Size & Filename */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
              color: 'var(--color-text-secondary)',
              fontWeight: 500,
            }}
          >
            <span>
              {dimsText}
              {sizeText ? ` • ${sizeText}` : ''}
            </span>
          </div>

          <div
            style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
            title={selectedUrl}
          >
            {displayBasename}
          </div>

          {/* Block or Stream guidance notice */}
          {readiness !== 'ready' && activeVariant?.blockReason && (
            <div
              style={{
                fontSize: 10,
                marginTop: 4,
                padding: '3px 6px',
                borderRadius: 4,
                backgroundColor:
                  readiness === 'stream_manifest'
                    ? 'var(--color-primary-subtle)'
                    : 'var(--color-danger-subtle)',
                color:
                  readiness === 'stream_manifest'
                    ? 'var(--color-primary-text)'
                    : 'var(--color-danger-text)',
              }}
            >
              {activeVariant.blockReason}
            </div>
          )}
        </div>

        {/* Variant Switcher Dropdown (if multiple <source> or parsed HLS variants exist) */}
        {item.variants.length > 1 && (
          <div onClick={(e) => e.stopPropagation()}>
            <select
              value={selectedUrl}
              onChange={(e) => {
                setHlsMergeError(null);
                onSelectVariant(e.target.value);
              }}
              style={{
                width: '100%',
                fontSize: 10,
                padding: '3px 5px',
                borderRadius: 4,
                border: '1px solid var(--color-border-input)',
                backgroundColor: 'var(--color-bg-subtle)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
              title="保存・再生する動画候補を切り替え"
            >
              {item.variants.map((v, idx) => {
                const vHint = !v.videoWidth || !v.videoHeight ? extractResolutionHint(v.url) : null;
                const vDims =
                  v.videoWidth && v.videoHeight
                    ? `${v.videoWidth}×${v.videoHeight}`
                    : v.descriptors.join(' ') || (vHint ? vHint.descriptor : `候補 ${idx + 1}`);
                const vSize = formatByteSize(v.fileSizeBytes);
                const vSizeSuffix = vSize ? ` (${vSize})` : '';
                const vState = v.readiness === 'ready' ? '' : ' [ストリーム/制限]';
                return (
                  <option key={v.url} value={v.url}>
                    {v.format.toUpperCase()} • {vDims}
                    {vSizeSuffix}
                    {vState}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Live HLS Segment Merge Progress or Error */}
        {(hlsMergeProgress !== null || hlsMergeError) && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {hlsMergeProgress !== null && hlsMergeProgress.totalSegments > 0 && (
              <div
                style={{
                  width: '100%',
                  height: 5,
                  backgroundColor: 'var(--color-bg-subtle)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.round((hlsMergeProgress.completedSegments / hlsMergeProgress.totalSegments) * 100))}%`,
                    height: '100%',
                    backgroundColor: 'var(--color-primary)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            )}
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: hlsMergeError ? 'var(--color-danger-text)' : 'var(--color-info-text)',
              }}
            >
              {hlsMergeError
                ? hlsMergeError
                : hlsMergeProgress && hlsMergeProgress.totalSegments > 0
                  ? `セグメント結合中: ${hlsMergeProgress.completedSegments}/${hlsMergeProgress.totalSegments} (${formatByteSize(hlsMergeProgress.bytesReceived) || '0 B'})`
                  : 'プレイリストを解析中...'}
            </div>
          </div>
        )}

        {/* Live Download Progress Bar */}
        {downloadState && downloadState.status !== 'idle' && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {progressPercent !== null && (
              <div
                style={{
                  width: '100%',
                  height: 5,
                  backgroundColor: 'var(--color-bg-subtle)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    backgroundColor: 'var(--color-primary)',
                    transition: 'width 0.25s ease',
                  }}
                />
              </div>
            )}
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color:
                  downloadState.status === 'completed'
                    ? 'var(--color-success-text)'
                    : downloadState.status === 'failed'
                      ? 'var(--color-danger-text)'
                      : 'var(--color-info-text)',
              }}
            >
              {downloadState.status === 'queued' && '待機中...'}
              {downloadState.status === 'starting' && '開始処理中...'}
              {downloadState.status === 'in_progress' &&
                (progressPercent !== null
                  ? `ダウンロード中: ${progressPercent}% (${formatByteSize(downloadState.bytesReceived)} / ${formatByteSize(downloadState.totalBytes)})`
                  : downloadState.bytesReceived
                    ? `ダウンロード中: ${formatByteSize(downloadState.bytesReceived)}`
                    : 'ダウンロード中...')}
              {downloadState.status === 'completed' && '✓ 保存完了'}
              {downloadState.status === 'canceled' && 'キャンセル済み'}
              {downloadState.status === 'failed' &&
                (downloadState.errorMessage || '保存に失敗しました')}
            </div>
          </div>
        )}

        {/* Action Button Row */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
          }}
        >
          {hlsMergeProgress !== null ? (
            <button
              type="button"
              onClick={handleCancelHlsMerge}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 5,
                border: '1px solid var(--color-danger-border)',
                backgroundColor: 'var(--color-danger-subtle)',
                color: 'var(--color-danger-text)',
                cursor: 'pointer',
              }}
              title="進行中のストリーム結合取得を中止します"
            >
              ✕ 結合中止
            </button>
          ) : isDownloading ? (
            <button
              type="button"
              onClick={onCancelDownload}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 5,
                border: '1px solid var(--color-danger-border)',
                backgroundColor: 'var(--color-danger-subtle)',
                color: 'var(--color-danger-text)',
                cursor: 'pointer',
              }}
              title="進行中のダウンロードを停止します"
            >
              ✕ 中止
            </button>
          ) : readiness === 'ready' ? (
            <button
              type="button"
              onClick={onDownload}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 5,
                border: 'none',
                backgroundColor: 'var(--color-primary)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
              title="この動画をダウンロードします"
            >
              📥 保存
            </button>
          ) : readiness === 'stream_manifest' ? (
            <>
              {activeVariant?.format === 'hls' && onMergeHlsStream && !item.isLive && (
                <button
                  type="button"
                  onClick={handleMergeHlsClick}
                  style={{
                    padding: '4px 7px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 5,
                    border: 'none',
                    backgroundColor: 'var(--color-primary)',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                  title="非暗号化VODのHLSセグメントを取得・結合して単一ファイルに保存します"
                >
                  📥 結合保存
                </button>
              )}
              {activeVariant?.format === 'hls' && (
                <button
                  type="button"
                  onClick={handleResolveHlsClick}
                  disabled={resolvingHls}
                  style={{
                    padding: '4px 7px',
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 5,
                    border: '1px solid var(--color-primary-subtle-border)',
                    backgroundColor: 'var(--color-primary-subtle)',
                    color: 'var(--color-primary-text)',
                    cursor: resolvingHls ? 'wait' : 'pointer',
                  }}
                  title="クリック時のみ .m3u8 を読み取り、含まれる解像度候補を展開します"
                >
                  {resolvingHls ? '解析中...' : '🎞️ 画質解析'}
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyCliCommand}
                style={{
                  flex: 1,
                  padding: '4px 7px',
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: '1px solid var(--color-border-input)',
                  backgroundColor: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
                title="yt-dlp 用の保存コマンドをクリップボードにコピーします"
              >
                {copiedType === 'cmd' ? '✓ コマンドコピー済' : '⌨️ yt-dlp'}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 5,
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg-subtle)',
                color: 'var(--color-text-muted)',
                cursor: 'not-allowed',
              }}
            >
              保存対象外
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenOriginal}
            style={{
              padding: '4px 7px',
              fontSize: 10,
              borderRadius: 5,
              border: '1px solid var(--color-border-input)',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
            title="新しいタブで動画URLを開く"
          >
            ↗
          </button>

          <button
            type="button"
            onClick={handleCopyUrl}
            style={{
              padding: '4px 7px',
              fontSize: 10,
              borderRadius: 5,
              border: '1px solid var(--color-border-input)',
              backgroundColor: 'var(--color-bg-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
            title="動画のURLをコピー"
          >
            {copiedType === 'url' ? '✓' : '📋'}
          </button>
        </div>
      </div>
    </div>
  );
};

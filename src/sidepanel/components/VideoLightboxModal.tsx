import React, { useEffect, useRef, useState } from 'react';
import type { ItemDownloadState, VideoItem } from '@shared/types';
import {
  formatByteSize,
  formatResolutionLabel,
  formatVideoDuration,
  getActiveVideoVariant,
} from '@shared/video-utils';
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PipIcon,
  StopIcon,
} from './Icons';

interface VideoLightboxModalProps {
  videos: VideoItem[];
  currentIndex: number;
  isSelected: boolean;
  downloadState?: ItemDownloadState;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onToggleSelect: (itemId: string) => void;
  onDownload: (itemId: string) => void;
  onCancelDownload: (itemId: string) => void;
  onSelectVariant: (itemId: string, variantUrl: string) => void;
  onReportVideoMetadata: (
    itemId: string,
    variantUrl: string,
    width: number | null,
    height: number | null,
    durationSec: number | null,
  ) => void;
  onSaveCapturedFrame: (
    dataUrl: string,
    sourceVideoUrl: string,
    timestampSec: number,
  ) => Promise<boolean>;
}

const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export const VideoLightboxModal: React.FC<VideoLightboxModalProps> = ({
  videos,
  currentIndex,
  isSelected,
  downloadState,
  onClose,
  onNavigate,
  onToggleSelect,
  onDownload,
  onCancelDownload,
  onSelectVariant,
  onReportVideoMetadata,
  onSaveCapturedFrame,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [copied, setCopied] = useState(false);
  const [frameNotice, setFrameNotice] = useState<string | null>(null);

  const currentVideo = videos[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < videos.length - 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        if (hasPrev) onNavigate(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && e.altKey) {
        if (hasNext) onNavigate(currentIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, hasPrev, hasNext, onClose, onNavigate]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, currentVideo?.selectedUrl]);

  if (!currentVideo) return null;

  const activeVariant = getActiveVideoVariant(
    currentVideo.variants,
    currentVideo.selectedUrl,
  );
  const selectedUrl = currentVideo.selectedUrl;
  const canSelectAndSave = activeVariant?.readiness === 'ready';
  const isDownloading =
    downloadState?.status === 'queued' ||
    downloadState?.status === 'starting' ||
    downloadState?.status === 'in_progress';

  const resLabel = formatResolutionLabel(
    activeVariant?.videoWidth,
    activeVariant?.videoHeight,
  );
  const formatText = (activeVariant?.format || 'unknown').toUpperCase();
  const durText = formatVideoDuration(currentVideo.durationSec, currentVideo.isLive);
  const sizeText = formatByteSize(activeVariant?.fileSizeBytes);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(selectedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleTogglePip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await el.requestPictureInPicture();
      }
    } catch {}
  };

  const handleCaptureFrame = async () => {
    const el = videoRef.current;
    if (!el || el.videoWidth <= 0 || el.videoHeight <= 0) {
      setFrameNotice('再生フレームがまだ読み込まれていません');
      setTimeout(() => setFrameNotice(null), 2200);
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const pngDataUrl = canvas.toDataURL('image/png');
      const ok = await onSaveCapturedFrame(pngDataUrl, selectedUrl, el.currentTime || 0);
      setFrameNotice(ok ? '✓ 現在のフレームをPNG保存しました' : 'フレーム保存に失敗しました');
    } catch {
      setFrameNotice('外部ドメイン保護 (CORS) のためフレーム抽出が制限されています');
    }
    setTimeout(() => setFrameNotice(null), 2500);
  };

  return (
    <div onClick={onClose} className="lightbox-backdrop">
      {/* Top Bar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
            {currentIndex + 1} / {videos.length}
          </span>
          <span
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {resLabel} • {formatText} • {durText}
            {sizeText ? ` • ${sizeText}` : ''}
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

      {/* Main Video Player Stage */}
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
        {hasPrev && (
          <button
            type="button"
            className="lightbox-nav-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            style={{ left: 2, width: 34, height: 34 }}
            aria-label="前の動画"
            title="前の動画 (Alt+←)"
          >
            <ChevronLeftIcon size={17} />
          </button>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            maxHeight: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            key={selectedUrl}
            src={selectedUrl}
            poster={currentVideo.posterUrl}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.playbackRate = playbackRate;
              const dur =
                Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
              onReportVideoMetadata(
                currentVideo.itemId,
                selectedUrl,
                v.videoWidth > 0 ? v.videoWidth : null,
                v.videoHeight > 0 ? v.videoHeight : null,
                dur,
              );
            }}
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 185px)',
              borderRadius: 8,
              backgroundColor: '#000000',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
            }}
          />

          {frameNotice && (
            <div
              className="card-overlay-pill"
              style={{
                marginTop: 8,
                padding: '4px 12px',
                borderRadius: 999,
                fontSize: 11,
              }}
            >
              {frameNotice}
            </div>
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            className="lightbox-nav-btn"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            style={{ right: 2, width: 34, height: 34 }}
            aria-label="次の動画"
            title="次の動画 (Alt+→)"
          >
            <ChevronRightIcon size={17} />
          </button>
        )}
      </div>

      {/* Bottom Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="lightbox-dock"
        style={{ padding: '9px 11px', fontSize: 11 }}
      >
        {/* Playback Speed, PiP, Frame Capture & Variant Selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>速度:</span>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`card-action-btn ${
                  playbackRate === rate ? 'variant-primary-tint' : 'variant-subtle'
                }`}
                onClick={() => setPlaybackRate(rate)}
                style={{ padding: '2px 7px', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
              >
                {rate}x
              </button>
            ))}

            <button
              type="button"
              className="card-action-btn variant-subtle"
              onClick={handleTogglePip}
              style={{ padding: '2px 8px', fontSize: 10 }}
              title="ピクチャーインピクチャー表示"
            >
              <PipIcon size={11} />
              <span>PiP</span>
            </button>

            <button
              type="button"
              className="card-action-btn variant-subtle"
              onClick={handleCaptureFrame}
              style={{ padding: '2px 8px', fontSize: 10 }}
              title="現在表示されている動画フレームを高画質PNG画像として保存します"
            >
              <CameraIcon size={11} />
              <span>フレーム保存</span>
            </button>
          </div>

          {currentVideo.variants.length > 1 && (
            <select
              className="filter-select"
              value={selectedUrl}
              onChange={(e) => onSelectVariant(currentVideo.itemId, e.target.value)}
              style={{ width: 'auto', fontSize: 10, padding: '3px 6px' }}
            >
              {currentVideo.variants.map((v, i) => (
                <option key={v.url} value={v.url}>
                  {v.format.toUpperCase()} •{' '}
                  {v.videoWidth && v.videoHeight
                    ? `${v.videoWidth}×${v.videoHeight}`
                    : v.descriptors.join(' ') || `候補 ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Selection & Primary Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {canSelectAndSave ? (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: isSelected ? 'var(--color-primary-text)' : 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(currentVideo.itemId)}
                style={{ margin: 0 }}
              />
              <span>選択対象に含める</span>
            </label>
          ) : (
            <span style={{ color: 'var(--color-danger-text)', fontSize: 10 }}>
              {activeVariant?.blockReason || '直接保存対象外'}
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className={`card-action-btn ${copied ? 'variant-success' : 'variant-subtle'}`}
              onClick={handleCopyUrl}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              {copied ? <CheckIcon size={11} /> : <CopyIcon size={11} />}
              <span>{copied ? 'コピー済' : 'URLコピー'}</span>
            </button>

            <button
              type="button"
              className="card-action-btn variant-subtle"
              onClick={() => chrome.tabs.create({ url: selectedUrl, active: false })}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              <ExternalLinkIcon size={11} />
              <span>別タブで開く</span>
            </button>

            {isDownloading ? (
              <button
                type="button"
                className="card-action-btn variant-danger"
                onClick={() => onCancelDownload(currentVideo.itemId)}
                style={{ padding: '5px 12px', fontSize: 11 }}
              >
                <StopIcon size={10} />
                <span>中止</span>
              </button>
            ) : (
              canSelectAndSave && (
                <button
                  type="button"
                  className="card-action-btn variant-primary-solid"
                  onClick={() => onDownload(currentVideo.itemId)}
                  style={{ padding: '5px 12px', fontSize: 11 }}
                >
                  <DownloadIcon size={12} />
                  <span>動画を保存</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import type { ItemDownloadState, VideoItem } from '@shared/types';
import {
  formatByteSize,
  formatResolutionLabel,
  formatVideoDuration,
  getActiveVideoVariant,
} from '@shared/video-utils';

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
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 12,
        boxSizing: 'border-box',
        backdropFilter: 'blur(4px)',
      }}
    >
      {/* Top Bar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontWeight: 600,
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
            }}
          >
            {currentIndex + 1} / {videos.length}
          </span>
          <span style={{ color: '#e5e7eb', fontSize: 11 }}>
            {resLabel} • {formatText} • {durText}
            {sizeText ? ` • ${sizeText}` : ''}
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
          }}
          title="閉じる (Esc)"
        >
          ✕
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
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex - 1);
            }}
            style={{
              position: 'absolute',
              left: 2,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '50%',
              width: 34,
              height: 34,
              fontSize: 16,
              cursor: 'pointer',
              zIndex: 10,
            }}
            title="前の動画 (Alt+←)"
          >
            ◀
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
              borderRadius: 6,
              backgroundColor: '#000000',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            }}
          />

          {frameNotice && (
            <div
              style={{
                marginTop: 6,
                padding: '3px 10px',
                borderRadius: 12,
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                color: '#f8fafc',
                fontSize: 11,
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              {frameNotice}
            </div>
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(currentIndex + 1);
            }}
            style={{
              position: 'absolute',
              right: 2,
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '50%',
              width: 34,
              height: 34,
              fontSize: 16,
              cursor: 'pointer',
              zIndex: 10,
            }}
            title="次の動画 (Alt+→)"
          >
            ▶
          </button>
        )}
      </div>

      {/* Bottom Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'rgba(31, 41, 55, 0.92)',
          borderRadius: 8,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: '#ffffff',
          fontSize: 11,
        }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#9ca3af', fontSize: 10 }}>速度:</span>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setPlaybackRate(rate)}
                style={{
                  padding: '2px 6px',
                  fontSize: 10,
                  borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.2)',
                  backgroundColor:
                    playbackRate === rate ? '#6366f1' : 'rgba(255,255,255,0.08)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: playbackRate === rate ? 600 : 400,
                }}
              >
                {rate}x
              </button>
            ))}

            <button
              type="button"
              onClick={handleTogglePip}
              style={{
                padding: '2px 7px',
                fontSize: 10,
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
              title="ピクチャーインピクチャー表示"
            >
              ⧉ PiP
            </button>

            <button
              type="button"
              onClick={handleCaptureFrame}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.25)',
                backgroundColor: 'rgba(255,255,255,0.12)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
              title="現在表示されている動画フレームを高画質PNG画像として保存します"
            >
              📸 フレーム保存
            </button>
          </div>

          {currentVideo.variants.length > 1 && (
            <select
              value={selectedUrl}
              onChange={(e) => onSelectVariant(currentVideo.itemId, e.target.value)}
              style={{
                fontSize: 10,
                padding: '3px 6px',
                borderRadius: 4,
                backgroundColor: '#111827',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.25)',
              }}
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
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(currentVideo.itemId)}
              />
              <span>選択対象に含める</span>
            </label>
          ) : (
            <span style={{ color: '#fca5a5', fontSize: 10 }}>
              {activeVariant?.blockReason || '直接保存対象外'}
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                borderRadius: 5,
                border: '1px solid rgba(255,255,255,0.25)',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              {copied ? '✓ コピー済' : 'URLコピー'}
            </button>

            <button
              type="button"
              onClick={() => chrome.tabs.create({ url: selectedUrl, active: false })}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                borderRadius: 5,
                border: '1px solid rgba(255,255,255,0.25)',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              別タブで開く
            </button>

            {isDownloading ? (
              <button
                type="button"
                onClick={() => onCancelDownload(currentVideo.itemId)}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                ✕ 中止
              </button>
            ) : (
              canSelectAndSave && (
                <button
                  type="button"
                  onClick={() => onDownload(currentVideo.itemId)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 5,
                    border: 'none',
                    backgroundColor: '#6366f1',
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  📥 動画を保存
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

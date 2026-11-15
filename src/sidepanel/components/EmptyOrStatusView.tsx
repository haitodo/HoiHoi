import React from 'react';
import type { MediaMode, ScanStatus } from '@shared/types';
import { RefreshIcon } from './Icons';

interface EmptyOrStatusViewProps {
  mediaMode?: MediaMode;
  scanStatus: ScanStatus;
  statusMessage?: string;
  isFilterEmpty: boolean;
  onClearFilter?: () => void;
  onRescan?: () => void;
}

export const EmptyOrStatusView: React.FC<EmptyOrStatusViewProps> = ({
  mediaMode = 'image',
  scanStatus,
  statusMessage,
  isFilterEmpty,
  onClearFilter,
  onRescan,
}) => {
  const isVideo = mediaMode === 'video';
  const mediaNoun = isVideo ? '動画' : '画像';
  let title = '';
  let description = '';
  let action: React.ReactNode = null;
  let bannerIcon: React.ReactNode = null;

  if (scanStatus === 'unscanned') {
    bannerIcon = (
      <div
        style={{
          padding: 10,
          borderRadius: 20,
          background:
            'radial-gradient(circle at 50% 35%, rgba(59, 130, 246, 0.18), rgba(20, 22, 27, 0.6))',
          border: '1px solid var(--color-border-strong)',
          marginBottom: 16,
          boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
        }}
      >
        <img
          src="icons/icon-128.png"
          alt="HoiHoi"
          style={{ width: 52, height: 52, borderRadius: 12, display: 'block' }}
        />
      </div>
    );
    title = 'このタブは未スキャンです';
    description =
      'ブラウザ右上のツールバーにある HoiHoi アイコンをクリックするか、下のボタンを押してスキャンを開始してください。';
    if (onRescan) {
      action = (
        <button
          type="button"
          className="panel-control panel-control-primary"
          onClick={onRescan}
          style={{ marginTop: 16, padding: '8px 18px', fontSize: 12, borderRadius: 7 }}
        >
          <RefreshIcon size={13} />
          <span>スキャンを開始する</span>
        </button>
      );
    }
  } else if (scanStatus === 'restricted') {
    title = 'このページはスキャンできません';
    description =
      statusMessage ||
      'ブラウザの内部保護ページ (edge://, chrome:// など) や Web Store では、セキュリティ上の理由から拡張機能による画像スキャンが制限されています。画像のある通常の Web ページでお試しください。';
  } else if (scanStatus === 'stale') {
    title = 'タブへのアクセス権が必要です';
    description =
      statusMessage ||
      'ブラウザのセキュリティ仕様により、ブラウザ右上のツールバーにある HoiHoi アイコンをクリックしてアクセス権を許可してください。';
    if (onRescan) {
      action = (
        <button
          type="button"
          className="panel-control panel-control-primary"
          onClick={onRescan}
          style={{ marginTop: 14, padding: '7px 14px', fontSize: 12 }}
        >
          <RefreshIcon size={12} />
          <span>再スキャンを試行</span>
        </button>
      );
    }
  } else if (isFilterEmpty) {
    title = `条件に合う${mediaNoun}がありません`;
    description = `設定されているフィルターや検索ワードに一致する${mediaNoun}が見つかりませんでした。`;
    if (onClearFilter) {
      action = (
        <button
          type="button"
          className="panel-control"
          onClick={onClearFilter}
          style={{ marginTop: 14, padding: '6px 14px', fontSize: 12 }}
        >
          フィルターをクリア
        </button>
      );
    }
  } else if (scanStatus === 'scanning') {
    title = `${mediaNoun}を探しています...`;
    description = `ページ内の${mediaNoun}をスキャンしています。見つかったものから順次表示されます。`;
  } else {
    title = `${mediaNoun}が見つかりませんでした`;
    description = isVideo
      ? 'この Web ページ内から検出可能な動画（video要素、動画直リンク、構造化メタデータ等）が見つかりませんでした。ページ上で動画を再生開始すると検出される場合があります。'
      : 'この Web ページ内から検出可能な画像（img, picture, CSS 背景画像, SVG など）が見つかりませんでした。ページを手動スクロールすると遅延読み込み画像が追加される場合があります。';
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        textAlign: 'center',
        color: 'var(--color-text-muted)',
      }}
    >
      {bannerIcon}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.6,
          margin: 0,
          maxWidth: 300,
          color: 'var(--color-text-secondary)',
        }}
      >
        {description}
      </p>
      {action}
    </div>
  );
};

import React from 'react';
import type { MediaMode, ScanStatus } from '@shared/types';

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
      <img
        src="icons/icon-128.png"
        alt="HoiHoi"
        style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
      />
    );
    title = 'このタブは未スキャンです';
    description =
      'ブラウザ右上のツールバーにある HoiHoi アイコンをクリックするか、下のボタンを押してスキャンを開始してください。';
    if (onRescan) {
      action = (
        <button
          onClick={onRescan}
          style={{
            marginTop: 14,
            padding: '8px 18px',
            fontSize: 13,
            backgroundColor: 'var(--color-primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          スキャンを開始する
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
          onClick={onRescan}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            fontSize: 12,
            backgroundColor: 'var(--color-primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          再スキャンを試行
        </button>
      );
    }
  } else if (isFilterEmpty) {
    title = `条件に合う${mediaNoun}がありません`;
    description = `設定されているフィルターや検索ワードに一致する${mediaNoun}が見つかりませんでした。`;
    if (onClearFilter) {
      action = (
        <button
          onClick={onClearFilter}
          style={{
            marginTop: 12,
            padding: '5px 12px',
            fontSize: 12,
            backgroundColor: 'var(--color-bg-subtle)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-input)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
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
        padding: 30,
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
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: 12,
          lineHeight: 1.5,
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

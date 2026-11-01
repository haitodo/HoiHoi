import React from 'react';
import type { ScanStatus } from '@shared/types';

interface EmptyOrStatusViewProps {
  scanStatus: ScanStatus;
  statusMessage?: string;
  isFilterEmpty: boolean;
  onClearFilter?: () => void;
  onRescan?: () => void;
}

export const EmptyOrStatusView: React.FC<EmptyOrStatusViewProps> = ({
  scanStatus,
  statusMessage,
  isFilterEmpty,
  onClearFilter,
  onRescan,
}) => {
  let title = '';
  let description = '';
  let action: React.ReactNode = null;

  if (scanStatus === 'unscanned') {
    title = 'このタブは未スキャンです';
    description =
      'ブラウザ右上のツールバーにある Web Image Collector アイコンをクリックして、このタブのスキャンを開始してください。';
  } else if (scanStatus === 'restricted') {
    title = 'このページはスキャンできません';
    description =
      'ブラウザの内部保護ページ (chrome:// など) や Chrome Web Store では、セキュリティ上の理由から拡張機能による画像スキャンが制限されています。通常の Web ページでお試しください。';
  } else if (scanStatus === 'stale') {
    title = 'ページが移動または再読込されました';
    description =
      statusMessage ||
      'ページのアクセス権限を更新するため、ブラウザ右上の拡張機能アイコンをクリックしてください。';
    if (onRescan) {
      action = (
        <button
          onClick={onRescan}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            fontSize: 12,
            backgroundColor: '#4f46e5',
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
    title = '条件に合う画像がありません';
    description = '設定されているフィルターや検索ワードに一致する画像が見つかりませんでした。';
    if (onClearFilter) {
      action = (
        <button
          onClick={onClearFilter}
          style={{
            marginTop: 12,
            padding: '5px 12px',
            fontSize: 12,
            backgroundColor: '#f3f4f6',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          フィルターをクリア
        </button>
      );
    }
  } else if (scanStatus === 'scanning') {
    title = '画像を探しています...';
    description = 'ページ内の画像をスキャンしています。見つかった画像から順次表示されます。';
  } else {
    title = '画像が見つかりませんでした';
    description =
      'この Web ページ内から検出可能な画像（img, picture, CSS 背景画像, SVG など）が見つかりませんでした。ページを手動スクロールすると遅延読み込み画像が追加される場合があります。';
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
        color: '#6b7280',
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>
        {title}
      </h3>
      <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, maxWidth: 300 }}>
        {description}
      </p>
      {action}
    </div>
  );
};

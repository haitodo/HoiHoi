import React from 'react';
import type { ScanStatus } from '@shared/types';

interface HeaderProps {
  domain?: string;
  pageTitle?: string;
  itemCount: number;
  scanStatus: ScanStatus;
  statusMessage?: string;
  onRescan: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  domain,
  pageTitle,
  itemCount,
  scanStatus,
  statusMessage,
  onRescan,
  isPinned,
  onTogglePin,
}) => {
  return (
    <header
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ overflow: 'hidden', marginRight: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: '#1a1a1a',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={pageTitle ? `${pageTitle} (${domain ?? ''})` : domain || 'Web Image Collector'}
          >
            {pageTitle || domain || 'Web Image Collector'}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 10,
              backgroundColor: '#eef2ff',
              color: '#4338ca',
              fontWeight: 500,
            }}
          >
            {itemCount} 件
          </span>
        </div>

        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          {scanStatus === 'scanning' && 'スキャン中...'}
          {scanStatus === 'watching' && '監視中 (スクロールで自動追加)'}
          {scanStatus === 'limit_reached' && '上限到達 (2,000件)'}
          {scanStatus === 'stale' && (statusMessage || 'ページ移動済み')}
          {scanStatus === 'restricted' && '保護ページ (スキャン不可)'}
          {scanStatus === 'unscanned' && '未スキャン'}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              fontWeight: 500,
              border: isPinned ? '1px solid #6366f1' : '1px solid #d1d5db',
              borderRadius: 6,
              backgroundColor: isPinned ? '#eef2ff' : '#ffffff',
              color: isPinned ? '#4338ca' : '#4b5563',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title={
              isPinned
                ? 'タブ固定中: 他のタブや別ウィンドウを選択してもこのページの表示を維持します（クリックで追従モードに変更）'
                : 'タブ追従中: ブラウザのアクティブタブに合わせて表示を切り替えます（クリックで現在のタブに固定）'
            }
          >
            <span>{isPinned ? '📌 固定中' : '🔓 追従中'}</span>
          </button>
        )}

        <button
          onClick={onRescan}
          disabled={scanStatus === 'scanning' || scanStatus === 'restricted'}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 500,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            backgroundColor: '#f9fafb',
            cursor: scanStatus === 'scanning' ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="ページを再スキャンして新しい画像を統合します"
        >
          再スキャン
        </button>
      </div>
    </header>
  );
};

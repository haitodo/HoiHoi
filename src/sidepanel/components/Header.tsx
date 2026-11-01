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
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-surface)',
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
          <img
            src="icons/icon-48.png"
            alt="HoiHoi"
            style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0 }}
          />
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--color-text-primary)',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={pageTitle ? `${pageTitle} (${domain ?? ''})` : domain || 'HoiHoi'}
          >
            {pageTitle || domain || 'HoiHoi'}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 10,
              backgroundColor: 'var(--color-primary-subtle)',
              color: 'var(--color-primary-text)',
              border: '1px solid var(--color-primary-subtle-border)',
              fontWeight: 500,
            }}
          >
            {itemCount} 件
          </span>
        </div>

        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
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
              border: isPinned
                ? '1px solid var(--color-primary)'
                : '1px solid var(--color-border-input)',
              borderRadius: 6,
              backgroundColor: isPinned
                ? 'var(--color-primary-subtle)'
                : 'var(--color-bg-surface)',
              color: isPinned
                ? 'var(--color-primary-text)'
                : 'var(--color-text-secondary)',
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
            border: '1px solid var(--color-border-input)',
            borderRadius: 6,
            backgroundColor: 'var(--color-bg-subtle)',
            color: 'var(--color-text-primary)',
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

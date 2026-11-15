import React from 'react';
import type { ScanStatus } from '@shared/types';

interface HeaderProps {
  domain?: string;
  pageTitle?: string;
  scanStatus: ScanStatus;
  statusMessage?: string;
  onRescan: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}

const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  unscanned: '未スキャン',
  scanning: 'スキャン中…',
  watching: '監視中',
  restricted: '保護ページ',
  stale: 'ページ移動済み',
  limit_reached: '上限到達',
  error: 'スキャン失敗',
};

export const Header: React.FC<HeaderProps> = ({
  domain,
  pageTitle,
  scanStatus,
  statusMessage,
  onRescan,
  isPinned,
  onTogglePin,
}) => {
  const statusLabel = SCAN_STATUS_LABELS[scanStatus];
  const statusTitle = statusMessage || (scanStatus === 'watching'
    ? '監視中 (スクロールで自動追加)'
    : statusLabel);

  return (
    <header
      style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <img
          src="icons/icon-48.png"
          alt=""
          style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0 }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={pageTitle && domain ? `${pageTitle} (${domain})` : pageTitle || domain || 'HoiHoi'}
        >
          {pageTitle || domain || 'HoiHoi'}
        </span>
        <span
          style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
          title={statusTitle}
        >
          {statusLabel}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {onTogglePin && (
          <button
            type="button"
            className="panel-control"
            onClick={onTogglePin}
            aria-pressed={isPinned ?? false}
            title={
              isPinned
                ? 'タブ固定中: 他のタブや別ウィンドウを選択してもこのページの表示を維持します（クリックで追従モードに変更）'
                : 'タブ追従中: ブラウザのアクティブタブに合わせて表示を切り替えます（クリックで現在のタブに固定）'
            }
          >
            {isPinned ? '📌 固定中' : '🔓 追従中'}
          </button>
        )}

        <button
          type="button"
          className="panel-control"
          onClick={onRescan}
          disabled={scanStatus === 'restricted'}
          title="ページを再スキャンして新しい画像を統合します"
        >
          再スキャン
        </button>
      </div>
    </header>
  );
};

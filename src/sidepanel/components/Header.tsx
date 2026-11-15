import React from 'react';
import type { ScanStatus } from '@shared/types';
import { PinIcon, RefreshIcon, UnlockTrackIcon } from './Icons';

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
  const statusTitle =
    statusMessage || (scanStatus === 'watching' ? '監視中 (スクロールで自動追加)' : statusLabel);

  return (
    <header className="panel-header">
      <div className="panel-header-brand">
        <img src="icons/icon-48.png" alt="" className="panel-header-icon" />
        <span
          className="panel-header-title"
          title={pageTitle && domain ? `${pageTitle} (${domain})` : pageTitle || domain || 'HoiHoi'}
        >
          {pageTitle || domain || 'HoiHoi'}
        </span>
        <span className={`panel-status-pill status-${scanStatus}`} title={statusTitle}>
          <span className="panel-status-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </span>
      </div>

      <div className="panel-header-actions">
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
            {isPinned ? <PinIcon size={11} /> : <UnlockTrackIcon size={11} />}
            <span>{isPinned ? '固定中' : '追従中'}</span>
          </button>
        )}

        <button
          type="button"
          className="panel-control"
          onClick={onRescan}
          disabled={scanStatus === 'restricted'}
          title="ページを再スキャンして新しい画像を統合します"
        >
          <RefreshIcon size={11} />
          <span>再スキャン</span>
        </button>
      </div>
    </header>
  );
};

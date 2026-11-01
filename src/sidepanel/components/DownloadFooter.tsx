import React from 'react';
import type { ItemDownloadState } from '@shared/types';
import { formatByteSize } from '@shared/video-utils';

interface DownloadFooterProps {
  downloads: Record<string, ItemDownloadState>;
  onRetryFailed: () => void;
  onCancelActive?: (itemIds: string[]) => void;
}

export const DownloadFooter: React.FC<DownloadFooterProps> = ({
  downloads,
  onRetryFailed,
  onCancelActive,
}) => {
  const downloadEntries = Object.values(downloads);
  if (downloadEntries.length === 0) return null;

  let queued = 0;
  let active = 0;
  let completed = 0;
  let failed = 0;
  let canceled = 0;
  let retryableFailed = 0;

  let sumReceived = 0;
  let sumTotal = 0;
  let hasKnownTotal = false;
  const cancellableIds: string[] = [];

  for (const dl of downloadEntries) {
    if (dl.status === 'queued') {
      queued++;
      cancellableIds.push(dl.itemId);
    } else if (dl.status === 'starting' || dl.status === 'in_progress') {
      active++;
      cancellableIds.push(dl.itemId);
      if (dl.bytesReceived !== undefined) {
        sumReceived += dl.bytesReceived;
      }
      if (dl.totalBytes && dl.totalBytes > 0) {
        sumTotal += dl.totalBytes;
        hasKnownTotal = true;
      }
    } else if (dl.status === 'completed') {
      completed++;
    } else if (dl.status === 'failed') {
      failed++;
      if (dl.retryable) retryableFailed++;
    } else if (dl.status === 'canceled') {
      canceled++;
    }
  }

  const hasAny = queued + active + completed + failed + canceled > 0;
  if (!hasAny) return null;

  const progressHint =
    active > 0 && hasKnownTotal && sumTotal > 0
      ? ` (${Math.min(100, Math.round((sumReceived / sumTotal) * 100))}% • ${formatByteSize(sumReceived)}/${formatByteSize(sumTotal)})`
      : active > 0 && sumReceived > 0
        ? ` (${formatByteSize(sumReceived)})`
        : '';

  return (
    <footer
      style={{
        padding: '8px 14px',
        backgroundColor: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {active > 0 && (
          <span style={{ color: 'var(--color-info-text)', fontWeight: 600 }}>
            実行中: {active}件{progressHint}
          </span>
        )}
        {queued > 0 && <span>待機中: {queued}件</span>}
        {completed > 0 && (
          <span style={{ color: 'var(--color-success-text)', fontWeight: 500 }}>
            完了: {completed}件
          </span>
        )}
        {failed > 0 && (
          <span style={{ color: 'var(--color-danger-text)', fontWeight: 600 }}>
            失敗: {failed}件
          </span>
        )}
        {canceled > 0 && (
          <span style={{ color: 'var(--color-text-muted)' }}>キャンセル: {canceled}件</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {cancellableIds.length > 0 && onCancelActive && (
          <button
            type="button"
            onClick={() => onCancelActive(cancellableIds)}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              backgroundColor: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border-input)',
              borderRadius: 4,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="待機中・実行中のダウンロードをすべて中止します"
          >
            中止
          </button>
        )}

        {retryableFailed > 0 && (
          <button
            type="button"
            onClick={onRetryFailed}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-danger-text)',
              backgroundColor: 'var(--color-danger-subtle)',
              border: '1px solid var(--color-danger-border)',
              borderRadius: 4,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="一時的なエラー等で失敗したアイテムを再試行します"
          >
            失敗を再試行 ({retryableFailed})
          </button>
        )}
      </div>
    </footer>
  );
};

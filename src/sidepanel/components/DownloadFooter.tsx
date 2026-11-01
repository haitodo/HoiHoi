import React from 'react';
import type { ItemDownloadState } from '@shared/types';

interface DownloadFooterProps {
  downloads: Record<string, ItemDownloadState>;
  onRetryFailed: () => void;
}

export const DownloadFooter: React.FC<DownloadFooterProps> = ({
  downloads,
  onRetryFailed,
}) => {
  const downloadEntries = Object.values(downloads);
  if (downloadEntries.length === 0) return null;

  let queued = 0;
  let active = 0;
  let completed = 0;
  let failed = 0;
  let canceled = 0;
  let retryableFailed = 0;

  for (const dl of downloadEntries) {
    if (dl.status === 'queued') queued++;
    else if (dl.status === 'starting' || dl.status === 'in_progress') active++;
    else if (dl.status === 'completed') completed++;
    else if (dl.status === 'failed') {
      failed++;
      if (dl.retryable) retryableFailed++;
    } else if (dl.status === 'canceled') canceled++;
  }

  const hasAny = queued + active + completed + failed + canceled > 0;
  if (!hasAny) return null;

  return (
    <footer
      style={{
        padding: '8px 14px',
        backgroundColor: '#ffffff',
        borderTop: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 11,
        color: '#4b5563',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {active > 0 && (
          <span style={{ color: '#2563eb', fontWeight: 600 }}>
            実行中: {active}件
          </span>
        )}
        {queued > 0 && <span>待機中: {queued}件</span>}
        {completed > 0 && (
          <span style={{ color: '#16a34a', fontWeight: 500 }}>
            完了: {completed}件
          </span>
        )}
        {failed > 0 && (
          <span style={{ color: '#dc2626', fontWeight: 600 }}>
            失敗: {failed}件
          </span>
        )}
        {canceled > 0 && <span style={{ color: '#9ca3af' }}>キャンセル: {canceled}件</span>}
      </div>

      {retryableFailed > 0 && (
        <button
          type="button"
          onClick={onRetryFailed}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 500,
            color: '#dc2626',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="一時的なエラー等で失敗した画像を再試行します"
        >
          失敗を再試行 ({retryableFailed})
        </button>
      )}
    </footer>
  );
};

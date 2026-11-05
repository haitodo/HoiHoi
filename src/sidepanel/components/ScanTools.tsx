import { useEffect, useRef, useState } from 'react';
import { isCollectionPageUrl } from '@shared/pagination-utils';
import type { TabSessionSnapshot } from '@shared/types';
import { useScanTools } from '../hooks/useScanTools';

export function ScanTools({
  snapshot,
  enabled,
}: {
  snapshot: TabSessionSnapshot | null;
  enabled: boolean;
}) {
  const available =
    enabled &&
    Boolean(snapshot && ['watching', 'scanning', 'limit_reached'].includes(snapshot.scanStatus));
  const { start, stop, progress, running } = useScanTools({
    tabId: snapshot?.tabId ?? null,
    scanEpoch: snapshot?.scanEpoch,
    pageUrl: snapshot?.pageUrl,
    enabled: available,
  });

  const unknown =
    snapshot?.items.filter((item) => {
      const variant = item.variants.find((entry) => entry.url === item.selectedUrl);
      return variant && !variant.largeDataRefId && (!variant.naturalWidth || !variant.naturalHeight);
    }).length ?? 0;

  const collectionSupported = isCollectionPageUrl(snapshot?.pageUrl);
  const blocked = !available || running;

  const [showNotice, setShowNotice] = useState(false);
  const lastProgressRef = useRef(progress);

  useEffect(() => {
    if (running) {
      setShowNotice(false);
    } else if (progress && progress.message && progress.status !== 'running') {
      setShowNotice(true);
      const timer = setTimeout(() => {
        setShowNotice(false);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [running, progress]);

  lastProgressRef.current = progress;

  return (
    <div className="scan-toolbar" role="region" aria-label="スキャンツールバー">
      {running ? (
        <div className="scan-running-bar" role="status" aria-live="polite">
          <div className="scan-running-info" title={progress?.message || '追加スキャンを実行中...'}>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }}
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            <span>{progress?.message || 'スキャンツールを実行中...'}</span>
          </div>
          <button
            type="button"
            className="scan-stop-btn"
            onClick={stop}
            title="実行中の処理を停止します"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            <span>停止</span>
          </button>
          <div className="scan-progress-track">
            <div className="scan-progress-bar" />
          </div>
        </div>
      ) : (
        <div className="scan-toolbar-actions">
          {/* 1. 寸法取得ボタン */}
          <button
            type="button"
            className={`scan-action-btn ${unknown > 0 ? 'has-highlight' : ''}`}
            disabled={blocked || unknown === 0}
            onClick={() => start('dimensions')}
            title={
              unknown > 0
                ? `未読み込み画像（${unknown}件）の寸法を調べ、サイズフィルターに反映します`
                : 'すべての画像の寸法を取得済みです'
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M21.3 8.7 8.7 21.3c-1 1-2.6 1-3.6 0l-2.4-2.4c-1-1-1-2.6 0-3.6L15.3 2.7c1-1 2.6-1 3.6 0l2.4 2.4c1 1 1 2.6 0 3.6Z" />
              <path d="m7.5 10.5 2 2" />
              <path d="m10.5 7.5 2 2" />
              <path d="m13.5 4.5 2 2" />
              <path d="m4.5 13.5 2 2" />
            </svg>
            <span>{unknown === 0 ? '寸法取得済' : '寸法取得'}</span>
            {unknown > 0 && <span className="scan-badge">{unknown}</span>}
          </button>

          {/* 2. 自動スクロールボタン */}
          <button
            type="button"
            className="scan-action-btn"
            disabled={blocked}
            onClick={() => start('scroll')}
            title="ページを末尾まで自動スクロールして遅延読み込み画像を発見し、終了後に元の位置に戻します"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <rect x="5" y="2" width="14" height="20" rx="7" />
              <line x1="12" y1="6" x2="12" y2="10" />
            </svg>
            <span>スクロール</span>
          </button>

          {/* 3. 別ページ収集ボタン */}
          <button
            type="button"
            className="scan-action-btn"
            disabled={blocked || !collectionSupported}
            onClick={() => start('pages')}
            title={
              collectionSupported
                ? '同じ一覧の次ページリンクを自動探索し、画像を追加します'
                : 'このページでは対応するページ送りリンクが検出されていません'
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <polyline points="10 9 13 12 10 15" />
            </svg>
            <span>次ページ収集</span>
          </button>
        </div>
      )}

      {/* 完了・停止・失敗のインライン通知 */}
      {!running && showNotice && progress && progress.message && (
        <div
          className={`scan-notice-bar notice-${progress.status}`}
          role="status"
          aria-live="polite"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
            {progress.status === 'completed' && (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {progress.message}
            </span>
          </div>
          <button
            type="button"
            className="scan-notice-close"
            onClick={() => setShowNotice(false)}
            aria-label="通知を閉じる"
            title="通知を閉じる"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

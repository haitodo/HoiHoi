import type { CSSProperties } from 'react';
import { isCollectionPageUrl } from '@shared/pagination-utils';
import type { TabSessionSnapshot } from '@shared/types';
import { useScanTools } from '../hooks/useScanTools';

const buttonStyle: CSSProperties = {
  border: '1px solid var(--color-border-input)', borderRadius: 6, padding: '5px 9px',
  fontSize: 12, background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', cursor: 'pointer',
};

function actionStyle(disabled: boolean): CSSProperties {
  return { ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' };
}

export function ScanTools({ snapshot, enabled }: { snapshot: TabSessionSnapshot | null; enabled: boolean }) {
  const available = enabled && Boolean(snapshot && ['watching', 'scanning', 'limit_reached'].includes(snapshot.scanStatus));
  const { start, stop, progress, running } = useScanTools({
    tabId: snapshot?.tabId ?? null, scanEpoch: snapshot?.scanEpoch, pageUrl: snapshot?.pageUrl, enabled: available,
  });
  const unknown = snapshot?.items.filter((item) => {
    const variant = item.variants.find((entry) => entry.url === item.selectedUrl);
    return variant && !variant.largeDataRefId && (!variant.naturalWidth || !variant.naturalHeight);
  }).length ?? 0;
  const collectionSupported = isCollectionPageUrl(snapshot?.pageUrl);
  const blocked = !available || running;
  return (
    <details style={{ padding: '7px 14px', borderBottom: '1px solid var(--color-border)', fontSize: 12, flexShrink: 0, maxHeight: '40vh', overflowY: 'auto' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary)' }}>追加スキャン（必要なときだけ）</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
        {progress && <div role="status" aria-live="polite">{progress.message}</div>}
        {running && <button style={buttonStyle} onClick={stop}>停止</button>}
        <div>
          <button style={actionStyle(blocked || unknown === 0)} disabled={blocked || unknown === 0} onClick={() => start('dimensions')}>寸法を取得（{unknown}件）</button>
          <div style={{ marginTop: 3, color: 'var(--color-text-muted)' }}>未読み込み画像の寸法を調べ、サイズフィルターに反映します。</div>
        </div>
        <div>
          <button style={actionStyle(blocked)} disabled={blocked} onClick={() => start('scroll')}>自動スクロール</button>
          <div style={{ marginTop: 3, color: 'var(--color-text-muted)' }}>ページを順にスクロールし、終了後に元の位置へ戻します。</div>
        </div>
        <div>
          <button style={actionStyle(blocked || !collectionSupported)} disabled={blocked || !collectionSupported} onClick={() => start('pages')}>別ページの画像を収集</button>
          <div style={{ marginTop: 3, color: 'var(--color-text-muted)' }}>ページ送りを検出し、同じ一覧の本文画像を追加します。判定できない場合は停止します。</div>
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>各ボタンを押した回だけ実行します。画像の保存は選択後に行えます。</div>
      </div>
    </details>
  );
}

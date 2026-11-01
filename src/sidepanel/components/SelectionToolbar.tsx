import React from 'react';
import type { CardSize } from '@shared/types';

interface SelectionToolbarProps {
  selectedCount: number;
  hiddenSelectedCount: number;
  visibleCount: number;
  hasVariants?: boolean;
  cardSize?: CardSize;
  onCardSizeChange?: (size: CardSize) => void;
  onSelectVisible: () => void;
  onClearAll: () => void;
  onDownloadSelected: () => void;
  onApplyVariantPreference?: (target: 'high_res' | 'display') => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectedCount,
  hiddenSelectedCount,
  visibleCount,
  hasVariants,
  cardSize = 'medium',
  onCardSizeChange,
  onSelectVisible,
  onClearAll,
  onDownloadSelected,
  onApplyVariantPreference,
}) => {
  return (
    <div
      style={{
        padding: '8px 10px',
        backgroundColor: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        fontSize: 11,
        boxSizing: 'border-box',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
            選択中: {selectedCount} 件
          </span>
          {hiddenSelectedCount > 0 && (
            <span style={{ color: 'var(--color-warning-text)', fontSize: 11 }}>
              (非表示 {hiddenSelectedCount}件)
            </span>
          )}
        </div>

        {onCardSizeChange && (
          <div
            style={{
              display: 'inline-flex',
              borderRadius: 4,
              border: '1px solid var(--color-border-input)',
              overflow: 'hidden',
              backgroundColor: 'var(--color-bg-surface)',
            }}
          >
            <button
              type="button"
              onClick={() => onCardSizeChange('auto')}
              style={{
                padding: '2px 7px',
                fontSize: 10,
                backgroundColor: cardSize === 'auto' ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                color: cardSize === 'auto' ? '#ffffff' : 'var(--color-text-secondary)',
                border: 'none',
                borderRight: '1px solid var(--color-border-input)',
                cursor: 'pointer',
                fontWeight: cardSize === 'auto' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
              title="自動調整（パネル幅に合わせて2〜5列レスポンシブ配置）"
            >
              自動
            </button>
            <button
              type="button"
              onClick={() => onCardSizeChange('small')}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                backgroundColor: cardSize === 'small' ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                color: cardSize === 'small' ? '#ffffff' : 'var(--color-text-secondary)',
                border: 'none',
                borderRight: '1px solid var(--color-border-input)',
                cursor: 'pointer',
                fontWeight: cardSize === 'small' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
              title="小サイズ表示（一覧性重視・3〜5列）"
            >
              小
            </button>
            <button
              type="button"
              onClick={() => onCardSizeChange('medium')}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                backgroundColor: cardSize === 'medium' ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                color: cardSize === 'medium' ? '#ffffff' : 'var(--color-text-secondary)',
                border: 'none',
                borderRight: '1px solid var(--color-border-input)',
                cursor: 'pointer',
                fontWeight: cardSize === 'medium' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
              title="中サイズ表示（標準・2〜3列）"
            >
              中
            </button>
            <button
              type="button"
              onClick={() => onCardSizeChange('large')}
              style={{
                padding: '2px 6px',
                fontSize: 10,
                backgroundColor: cardSize === 'large' ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                color: cardSize === 'large' ? '#ffffff' : 'var(--color-text-secondary)',
                border: 'none',
                cursor: 'pointer',
                fontWeight: cardSize === 'large' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}
              title="大サイズ表示（詳細重視・サイドバー幅に合わせた特大表示）"
            >
              大
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {hasVariants && onApplyVariantPreference && (
          <button
            type="button"
            onClick={() => onApplyVariantPreference('high_res')}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              border: '1px solid var(--color-primary-subtle-border)',
              borderRadius: 4,
              backgroundColor: 'var(--color-primary-subtle)',
              color: 'var(--color-primary-text)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="モーダルリンク先や高解像度候補に一括切替します"
          >
            高解像度を一括適用
          </button>
        )}

        <button
          type="button"
          onClick={onSelectVisible}
          disabled={visibleCount === 0}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            border: '1px solid var(--color-border-input)',
            borderRadius: 4,
            backgroundColor: 'var(--color-bg-subtle)',
            color: 'var(--color-text-primary)',
            cursor: visibleCount === 0 ? 'not-allowed' : 'pointer',
          }}
          title="現在フィルターされて画面に表示されている画像をすべて選択します"
        >
          表示中を全選択 ({visibleCount}件)
        </button>

        <button
          type="button"
          onClick={onClearAll}
          disabled={selectedCount === 0}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            border: '1px solid var(--color-border-input)',
            borderRadius: 4,
            backgroundColor: 'var(--color-bg-subtle)',
            color: 'var(--color-text-primary)',
            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
          }}
          title="すべての選択を解除します（非表示中の選択も含む）"
        >
          全解除
        </button>

        <button
          type="button"
          onClick={onDownloadSelected}
          disabled={selectedCount === 0}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            borderRadius: 4,
            backgroundColor: selectedCount > 0 ? 'var(--color-primary)' : 'var(--color-bg-subtle)',
            color: selectedCount > 0 ? '#ffffff' : 'var(--color-text-muted)',
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          ダウンロード ({selectedCount})
        </button>
      </div>
    </div>
  );
};

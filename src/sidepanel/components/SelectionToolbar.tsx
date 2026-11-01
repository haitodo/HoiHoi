import React from 'react';

interface SelectionToolbarProps {
  selectedCount: number;
  hiddenSelectedCount: number;
  visibleCount: number;
  onSelectVisible: () => void;
  onClearAll: () => void;
  onDownloadSelected: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectedCount,
  hiddenSelectedCount,
  visibleCount,
  onSelectVisible,
  onClearAll,
  onDownloadSelected,
}) => {
  return (
    <div
      style={{
        padding: '8px 14px',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, color: '#111827' }}>
          選択中: {selectedCount} 件
        </span>
        {hiddenSelectedCount > 0 && (
          <span style={{ color: '#d97706', fontSize: 11 }}>
            (非表示 {hiddenSelectedCount}件)
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={onSelectVisible}
          disabled={visibleCount === 0}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#f9fafb',
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
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#f9fafb',
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
            backgroundColor: selectedCount > 0 ? '#4f46e5' : '#e5e7eb',
            color: selectedCount > 0 ? '#ffffff' : '#9ca3af',
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          ダウンロード ({selectedCount})
        </button>
      </div>
    </div>
  );
};

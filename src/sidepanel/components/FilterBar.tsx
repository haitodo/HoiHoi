import React from 'react';
import type { FilterState, ImageFormat, SortOrder } from '@shared/types';

interface FilterBarProps {
  filter: FilterState;
  onChange: (next: FilterState) => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  onReset?: () => void;
  unknownDimensionsCount: number;
}

const AVAILABLE_FORMATS: Array<{ label: string; value: ImageFormat }> = [
  { label: 'JPG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'GIF', value: 'gif' },
  { label: 'WebP', value: 'webp' },
  { label: 'SVG', value: 'svg' },
  { label: 'AVIF', value: 'avif' },
  { label: '不明', value: 'unknown' },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onChange,
  sortOrder,
  onSortChange,
  onReset,
  unknownDimensionsCount,
}) => {
  const toggleFormat = (fmt: ImageFormat) => {
    const isSelected = filter.formats.includes(fmt);
    const nextFormats = isSelected
      ? filter.formats.filter((f) => f !== fmt)
      : [...filter.formats, fmt];
    onChange({ ...filter, formats: nextFormats });
  };

  const hasDimensionFilter = (filter.minWidth ?? 0) > 0 || (filter.minHeight ?? 0) > 0;
  const isFilterActive = Boolean(
    filter.urlQuery ||
      hasDimensionFilter ||
      filter.formats.length > 0 ||
      filter.includeUnknownDimensions,
  );

  return (
    <div
      style={{
        padding: '10px 14px',
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Search Input */}
      <div>
        <input
          type="text"
          placeholder="URL部分一致で絞り込み..."
          value={filter.urlQuery}
          onChange={(e) => onChange({ ...filter, urlQuery: e.target.value })}
          style={{
            width: '100%',
            padding: '5px 8px',
            fontSize: 12,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Dimension Filters & Sort Order */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 70px' }}>
          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>最小幅:</span>
          <input
            type="number"
            min="0"
            step="10"
            placeholder="px"
            value={filter.minWidth ?? ''}
            onChange={(e) =>
              onChange({
                ...filter,
                minWidth: e.target.value ? Math.max(0, Number(e.target.value)) : null,
              })
            }
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid #d1d5db',
              borderRadius: 4,
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 70px' }}>
          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>最小高:</span>
          <input
            type="number"
            min="0"
            step="10"
            placeholder="px"
            value={filter.minHeight ?? ''}
            onChange={(e) =>
              onChange({
                ...filter,
                minHeight: e.target.value ? Math.max(0, Number(e.target.value)) : null,
              })
            }
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid #d1d5db',
              borderRadius: 4,
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1.2 1 125px' }}>
          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>並び順:</span>
          <select
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as SortOrder)}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 11,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#ffffff',
              color: '#374151',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="並び替え順序を変更"
          >
            <option value="position_asc">配置順 (上から下)</option>
            <option value="position_desc">配置順 (下から上)</option>
            <option value="size_desc">解像度 (大きい順)</option>
            <option value="size_asc">解像度 (小さい順)</option>
            <option value="filename_asc">ファイル名 (A-Z)</option>
            <option value="filename_desc">ファイル名 (Z-A)</option>
            <option value="selected_first">選択中を先頭</option>
          </select>
        </div>
      </div>

      {/* Format Chips & Reset */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {AVAILABLE_FORMATS.map((f) => {
            const selected = filter.formats.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => toggleFormat(f.value)}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 12,
                  border: '1px solid',
                  borderColor: selected ? '#4f46e5' : '#d1d5db',
                  backgroundColor: selected ? '#4f46e5' : '#ffffff',
                  color: selected ? '#ffffff' : '#374151',
                  cursor: 'pointer',
                  fontWeight: selected ? 600 : 400,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {onReset && isFilterActive && (
          <button
            type="button"
            onClick={onReset}
            style={{
              fontSize: 11,
              color: '#6b7280',
              background: 'none',
              border: 'none',
              padding: '2px 4px',
              cursor: 'pointer',
              textDecoration: 'underline',
              whiteSpace: 'nowrap',
            }}
            title="すべてのフィルター条件（検索・幅・高さ・形式）をリセットします"
          >
            条件リセット
          </button>
        )}
      </div>

      {/* Unknown Dimension Banner (MVP-11) */}
      {hasDimensionFilter && unknownDimensionsCount > 0 && (
        <div
          style={{
            fontSize: 11,
            backgroundColor: '#fffbeb',
            border: '1px solid #fef3c7',
            padding: '4px 8px',
            borderRadius: 4,
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>寸法不明のため判定できない画像: {unknownDimensionsCount}件</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filter.includeUnknownDimensions}
              onChange={(e) =>
                onChange({ ...filter, includeUnknownDimensions: e.target.checked })
              }
            />
            <span>表示する</span>
          </label>
        </div>
      )}
    </div>
  );
};

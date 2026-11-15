import React from 'react';
import type { FilterState, ImageFormat, SortOrder } from '@shared/types';

interface FilterBarProps {
  filter: FilterState;
  onChange: (next: FilterState) => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  onClear?: () => void;
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
  onClear,
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
    <div className="filter-section">
      {/* Search Input */}
      <div>
        <input
          type="text"
          className="filter-input"
          aria-label="画像URLで絞り込み"
          placeholder="URL部分一致で絞り込み..."
          value={filter.urlQuery}
          onChange={(e) => onChange({ ...filter, urlQuery: e.target.value })}
        />
      </div>

      {/* Dimension Filters & Sort Order */}
      <div className="filter-row">
        <div className="filter-field">
          <span className="filter-field-label">最小幅:</span>
          <input
            type="number"
            className="filter-input"
            aria-label="最小幅"
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
          />
        </div>

        <div className="filter-field">
          <span className="filter-field-label">最小高:</span>
          <input
            type="number"
            className="filter-input"
            aria-label="最小高"
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
          />
        </div>

        <div className="filter-field" style={{ flex: '1.2 1 125px' }}>
          <span className="filter-field-label">並び順:</span>
          <select
            className="filter-select"
            aria-label="並び順"
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as SortOrder)}
            style={{ fontWeight: 500 }}
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
        <div className="filter-chips">
          {AVAILABLE_FORMATS.map((f) => {
            const selected = filter.formats.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                className={`filter-chip ${selected ? 'is-selected' : ''}`}
                onClick={() => toggleFormat(f.value)}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {onClear && isFilterActive && (
          <button
            type="button"
            className="filter-link-btn"
            onClick={onClear}
            title="すべてのフィルター条件（検索・幅・高さ・形式）を解除します"
          >
            条件をクリア
          </button>
        )}
      </div>

    </div>
  );
};

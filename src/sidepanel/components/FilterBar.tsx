import React from 'react';
import type { FilterState, ImageFormat } from '@shared/types';

interface FilterBarProps {
  filter: FilterState;
  onChange: (next: FilterState) => void;
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

      {/* Dimension Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
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
      </div>

      {/* Format Chips */}
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

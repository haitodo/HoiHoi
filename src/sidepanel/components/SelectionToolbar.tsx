import type { CardSize, MediaMode } from '@shared/types';
import { DownloadIcon } from './Icons';

interface SelectionToolbarProps {
  mediaMode: MediaMode;
  selectedCount: number;
  hiddenSelectedCount: number;
  selectableCount: number;
  onSelectVisible: () => void;
  onDownloadSelected: () => void;
}

export function SelectionToolbar({
  mediaMode,
  selectedCount,
  hiddenSelectedCount,
  selectableCount,
  onSelectVisible,
  onDownloadSelected,
}: SelectionToolbarProps) {
  const mediaNoun = mediaMode === 'video' ? '動画' : '画像';
  return (
    <div className="selection-toolbar" role="group" aria-label="選択とダウンロード">
      <button
        type="button"
        className="panel-control"
        onClick={onSelectVisible}
        disabled={selectableCount === 0}
        title={`現在フィルターされて保存条件を満たす${mediaNoun}をすべて選択します`}
      >
        表示中を全選択 ({selectableCount}件)
      </button>

      <button
        type="button"
        className="panel-control panel-control-primary"
        onClick={onDownloadSelected}
        disabled={selectedCount === 0}
      >
        <DownloadIcon size={12} />
        <span>ダウンロード ({selectedCount})</span>
      </button>

      {hiddenSelectedCount > 0 && (
        <span
          className="selection-hidden-count"
          title={`絞り込み条件の対象外に選択中の${mediaNoun}があります`}
        >
          {mediaMode === 'image' ? '条件外' : '非表示'} {hiddenSelectedCount}件
        </span>
      )}
    </div>
  );
}

const CARD_SIZE_OPTIONS: ReadonlyArray<{ value: CardSize; label: string; title: string }> = [
  { value: 'auto', label: '自動', title: 'パネル幅に合わせて列数を自動調整' },
  { value: 'small', label: '小', title: '一覧性を重視した小サイズ表示' },
  { value: 'medium', label: '中', title: '標準サイズ表示' },
  { value: 'large', label: '大', title: '詳細を確認しやすい大サイズ表示' },
];

interface SelectionOptionsProps {
  mediaMode: MediaMode;
  cardSize: CardSize;
  onCardSizeChange: (size: CardSize) => void;
  autoSelectAll?: boolean;
  onAutoSelectAllChange?: (enabled: boolean) => void;
  canDeselectVisible: boolean;
  canClearAll: boolean;
  onDeselectVisible: () => void;
  onClearAll: () => void;
  onApplyHighestQuality?: () => void;
}

export function SelectionOptions({
  mediaMode,
  cardSize,
  onCardSizeChange,
  autoSelectAll,
  onAutoSelectAllChange,
  canDeselectVisible,
  canClearAll,
  onDeselectVisible,
  onClearAll,
  onApplyHighestQuality,
}: SelectionOptionsProps) {
  const mediaNoun = mediaMode === 'video' ? '動画' : '画像';

  return (
    <div className="selection-options">
      <div className="selection-options-row">
        <div className="selection-options-row" role="group" aria-label="表示サイズ">
          <span className="filter-field-label">表示サイズ</span>
          {CARD_SIZE_OPTIONS.map(({ value, label, title }) => (
            <button
              key={value}
              type="button"
              className="panel-control"
              aria-pressed={cardSize === value}
              onClick={() => onCardSizeChange(value)}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>

        {onAutoSelectAllChange && (
          <label
            className="auto-select-option"
            title="ページスキャン時に検出された画像を自動で全選択します（一括取得・除外選択向け）"
          >
            <input
              type="checkbox"
              checked={autoSelectAll ?? true}
              onChange={(e) => onAutoSelectAllChange(e.target.checked)}
            />
            スキャン時に全選択
          </label>
        )}
      </div>

      <div className="selection-options-row">
        <button
          type="button"
          className="panel-control"
          onClick={onDeselectVisible}
          disabled={!canDeselectVisible}
          title={`現在表示されている選択中の${mediaNoun}のみ解除します（非表示中の選択は保持）`}
        >
          表示中を解除
        </button>
        <button
          type="button"
          className="panel-control"
          onClick={onClearAll}
          disabled={!canClearAll}
          title="条件外も含め、すべての選択を解除します"
        >
          全解除
        </button>
        {onApplyHighestQuality && (
          <button
            type="button"
            className="panel-control"
            onClick={onApplyHighestQuality}
            title={`最高画質の保存可能な${mediaNoun}候補に一括切替します`}
          >
            {mediaMode === 'video' ? '高画質を一括適用' : '高解像度を一括適用'}
          </button>
        )}
      </div>
    </div>
  );
}

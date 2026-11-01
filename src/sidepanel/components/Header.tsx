import React from 'react';
import type { ScanStatus } from '@shared/types';

interface HeaderProps {
  domain?: string;
  pageTitle?: string;
  itemCount: number;
  scanStatus: ScanStatus;
  statusMessage?: string;
  onRescan: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  domain,
  pageTitle,
  itemCount,
  scanStatus,
  statusMessage,
  onRescan,
}) => {
  return (
    <header
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ overflow: 'hidden', marginRight: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: '#1a1a1a',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={pageTitle ? `${pageTitle} (${domain ?? ''})` : domain || 'Web Image Collector'}
          >
            {pageTitle || domain || 'Web Image Collector'}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 10,
              backgroundColor: '#eef2ff',
              color: '#4338ca',
              fontWeight: 500,
            }}
          >
            {itemCount} 件
          </span>
        </div>

        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          {scanStatus === 'scanning' && 'スキャン中...'}
          {scanStatus === 'watching' && '監視中 (スクロールで自動追加)'}
          {scanStatus === 'limit_reached' && '上限到達 (2,000件)'}
          {scanStatus === 'stale' && (statusMessage || 'ページ移動済み')}
          {scanStatus === 'restricted' && '保護ページ (スキャン不可)'}
          {scanStatus === 'unscanned' && '未スキャン'}
        </div>
      </div>

      <button
        onClick={onRescan}
        disabled={scanStatus === 'scanning' || scanStatus === 'restricted'}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          fontWeight: 500,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          backgroundColor: '#f9fafb',
          cursor: scanStatus === 'scanning' ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
        }}
        title="ページを再スキャンして新しい画像を統合します"
      >
        再スキャン
      </button>
    </header>
  );
};

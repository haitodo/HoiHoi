import { useCallback, useEffect, useRef, useState } from 'react';
import { PORT_NAMES } from '@shared/constants';
import type { ScanToolKind, ScanToolProgress, ScanToolProgressMessage, StartScanToolMessage } from '@shared/messages';

export function useScanTools(options: { tabId: number | null; scanEpoch?: number; pageUrl?: string; enabled: boolean }) {
  const { tabId, scanEpoch, pageUrl, enabled } = options;
  const [progress, setProgress] = useState<ScanToolProgress | null>(null);
  const connection = useRef<chrome.runtime.Port | null>(null);
  const stop = useCallback(() => {
    const port = connection.current;
    connection.current = null;
    port?.disconnect();
    setProgress((previous) => previous?.status === 'running'
      ? { ...previous, status: 'stopped', message: '追加スキャンを停止しました' } : previous);
  }, []);

  useEffect(() => {
    stop(); setProgress(null);
    return () => { const port = connection.current; connection.current = null; port?.disconnect(); };
  }, [tabId, scanEpoch, pageUrl, enabled, stop]);

  const start = useCallback((tool: ScanToolKind) => {
    if (!enabled || tabId === null || scanEpoch === undefined || connection.current) return;
    setProgress({ tool, status: 'running', current: 0, message: '準備中…' });
    try {
      const port = chrome.runtime.connect({ name: PORT_NAMES.SCAN_TOOLS });
      connection.current = port;
      port.onMessage.addListener((reply: ScanToolProgressMessage) => {
        if (connection.current !== port || reply?.type !== 'SCAN_TOOL_PROGRESS') return;
        setProgress(reply.progress);
        if (reply.progress.status !== 'running') {
          connection.current = null; port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (connection.current !== port) return;
        connection.current = null;
        setProgress((previous) => previous ? { ...previous, status: 'failed', message: '接続が切れたため停止しました' } : previous);
      });
      port.postMessage({ type: 'START_SCAN_TOOL', tabId, scanEpoch, tool } satisfies StartScanToolMessage);
    } catch (error) {
      connection.current?.disconnect(); connection.current = null;
      setProgress({ tool, status: 'failed', current: 0, message: String(error) });
    }
  }, [enabled, tabId, scanEpoch]);
  return { start, stop, progress, running: progress?.status === 'running' };
}

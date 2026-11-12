import { useEffect, useRef, useState } from 'react';
import { PORT_NAMES } from '@shared/constants';
import type { TabSessionSnapshot } from '@shared/types';
import type { PanelWatchMessage, ScannerWatchMessage } from '@shared/messages';

/** Panel -> page connection owns observation, independently of the MV3 worker lifetime. */
export function usePanelActivity(tabId: number | null, snapshot: TabSessionSnapshot | null) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const [scannerGeneration, setScannerGeneration] = useState(0);
  const backgroundPort = useRef<chrome.runtime.Port | null>(null);
  const scannerConnection = useRef<{ port: chrome.runtime.Port; retryOnDisconnect: boolean } | null>(null);
  const watchable = snapshot?.tabId === tabId &&
    ['scanning', 'watching', 'limit_reached'].includes(snapshot.scanStatus);
  const watchedTabId = visible && watchable ? tabId : null;
  const targetTabId = visible ? tabId : null;
  const targetRef = useRef(targetTabId);
  targetRef.current = targetTabId;

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    const onBackgroundReady = (message: { type?: string; tabId?: number }) => {
      if (message?.type === 'HOIHOI_BACKGROUND_READY') {
        setWorkerGeneration((value) => value + 1);
      } else if (message?.type === 'HOIHOI_SCANNER_READY' && message.tabId === targetRef.current) {
        const connection = scannerConnection.current;
        if (connection) {
          // Injection can finish before Chrome reports that the initial port has no receiver.
          connection.retryOnDisconnect = true;
        } else {
          setScannerGeneration((value) => value + 1);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    chrome.runtime.onMessage.addListener(onBackgroundReady);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      chrome.runtime.onMessage.removeListener(onBackgroundReady);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const port = chrome.runtime.connect({ name: PORT_NAMES.SIDEPANEL_LIFECYCLE });
    backgroundPort.current = port;
    port.postMessage({ type: 'PANEL_WATCH_TAB', tabId: targetRef.current } satisfies PanelWatchMessage);
    port.onDisconnect.addListener(() => {
      // Idle worker shutdown is normal. Reconnect only on a real event, never on a timer.
      void chrome.runtime.lastError;
      if (backgroundPort.current === port) backgroundPort.current = null;
    });
    return () => {
      if (backgroundPort.current === port) backgroundPort.current = null;
      port.disconnect();
    };
  }, [visible, workerGeneration]);

  useEffect(() => {
    const message: PanelWatchMessage = { type: 'PANEL_WATCH_TAB', tabId: targetTabId };
    if (targetTabId !== null && !backgroundPort.current) {
      setWorkerGeneration((value) => value + 1);
      return;
    }
    try { backgroundPort.current?.postMessage(message); } catch {}
  }, [targetTabId]);

  useEffect(() => {
    if (watchedTabId === null) return;
    const port = chrome.tabs.connect(watchedTabId, { name: PORT_NAMES.SCANNER_LIFECYCLE });
    const connection = { port, retryOnDisconnect: false };
    scannerConnection.current = connection;
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (scannerConnection.current !== connection) return;
      scannerConnection.current = null;
      if (connection.retryOnDisconnect && targetRef.current === watchedTabId) {
        setScannerGeneration((value) => value + 1);
      }
    });
    return () => {
      if (scannerConnection.current === connection) scannerConnection.current = null;
      port.disconnect();
    };
  }, [watchedTabId, scannerGeneration]);

  useEffect(() => {
    if (snapshot?.scanEpoch === undefined) return;
    try {
      scannerConnection.current?.port.postMessage({ type: 'SCANNER_WATCH', scanEpoch: snapshot.scanEpoch } satisfies ScannerWatchMessage);
    } catch {}
  }, [watchedTabId, scannerGeneration, snapshot?.scanEpoch]);

  return visible;
}

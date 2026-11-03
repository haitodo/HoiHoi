import {
  PAGE_COLLECTION_HTML_MAX_CHARS, IMAGE_PROBE_CONCURRENCY, IMAGE_PROBE_TIMEOUT_MS,
  MAX_ITEMS_PER_TAB, SCAN_BATCH_MAX_SIZE, SCAN_TOOL_MAX_DURATION_MS,
} from '@shared/constants';
import { readTextLimited } from '@shared/response-utils';
import type { ContentToBackgroundMessage, RunScanToolMessage, ScanToolProgress, ScanToolProgressMessage } from '@shared/messages';
import { collectPages } from './page-collector';
import type { ExtractorContext } from './dom-extractor';
import { parseCollectionDocument } from './page-document';

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function probeImageDimensions(url: string, signal: AbortSignal): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const image = new Image();
    const finish = (value: { width: number; height: number } | null) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      image.onload = null; image.onerror = null;
      image.removeAttribute('src');
      resolve(value);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), IMAGE_PROBE_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0
      ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

export async function probeDimensions(options: {
  urls: string[]; signal: AbortSignal;
  onDimension: (url: string, width: number, height: number) => Promise<void>;
  onProgress: (current: number, total: number, failed: number) => void;
  probe?: typeof probeImageDimensions;
}): Promise<void> {
  const { signal, onDimension, onProgress, probe = probeImageDimensions } = options;
  const urls = [...new Set(options.urls)].slice(0, MAX_ITEMS_PER_TAB);
  let next = 0; let current = 0; let failed = 0;
  onProgress(0, urls.length, 0);
  await Promise.all(Array.from({ length: Math.min(IMAGE_PROBE_CONCURRENCY, urls.length) }, async () => {
    while (!signal.aborted && next < urls.length) {
      const url = urls[next++]!;
      const result = await probe(url, signal);
      if (signal.aborted) return;
      if (result) await onDimension(url, result.width, result.height);
      else failed++;
      onProgress(++current, urls.length, failed);
    }
  }));
  signal.throwIfAborted();
}

export async function scrollPage(signal: AbortSignal, onProgress: (steps: number) => void): Promise<void> {
  const original = { left: window.scrollX, top: window.scrollY };
  let restore = true;
  // Respect manual page navigation; explicit Stop still restores the original position.
  const manual = () => { restore = false; local.abort(); };
  const keydown = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) manual();
  };
  const local = new AbortController();
  const abort = () => local.abort(signal.reason);
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  window.addEventListener('wheel', manual, { passive: true });
  window.addEventListener('touchstart', manual, { passive: true });
  window.addEventListener('keydown', keydown);
  let stable = 0; let lastHeight = -1;
  try {
    window.scrollTo({ top: 0, left: original.left, behavior: 'instant' });
    for (let steps = 1; steps <= 200; steps++) {
      await pause(800, local.signal);
      const height = document.scrollingElement?.scrollHeight ?? document.documentElement.scrollHeight;
      const bottom = window.scrollY + window.innerHeight >= height - 2;
      stable = bottom && height === lastHeight ? stable + 1 : 0;
      lastHeight = height;
      onProgress(steps);
      if (stable >= 3) return;
      window.scrollTo({ left: original.left, top: Math.min(height, window.scrollY + window.innerHeight * 0.8), behavior: 'instant' });
    }
    throw new Error('スクロール回数の上限に到達しました');
  } finally {
    signal.removeEventListener('abort', abort);
    window.removeEventListener('wheel', manual);
    window.removeEventListener('touchstart', manual);
    window.removeEventListener('keydown', keydown);
    if (restore) window.scrollTo({ ...original, behavior: 'instant' });
  }
}

export function createScanToolsController(options: { getEpoch: () => number; largeDataUrlStore: Map<string, string> }) {
  let active: AbortController | undefined;
  const stop = () => active?.abort();
  const attach = (port: chrome.runtime.Port) => {
    let started = false;
    let controller: AbortController | undefined;
    port.onDisconnect.addListener(() => controller?.abort());
    port.onMessage.addListener((message: RunScanToolMessage) => {
      if (started || message?.type !== 'RUN_SCAN_TOOL') return;
      started = true;
      let progress: ScanToolProgress = { tool: message.tool, status: 'running', current: 0, message: '準備中…' };
      const report = (patch: Partial<ScanToolProgress>) => {
        progress = { ...progress, ...patch };
        try { port.postMessage({ type: 'SCAN_TOOL_PROGRESS', progress } satisfies ScanToolProgressMessage); } catch {}
      };
      if (active) { report({ status: 'failed', message: 'このページでは別の追加スキャンを実行中です' }); return; }
      controller = new AbortController(); active = controller;
      const signal = controller.signal;
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (options.getEpoch() !== message.scanEpoch || window.location.href !== message.pageUrl) {
          controller?.abort(); signal.throwIfAborted();
        }
      };
      const send = async (msg: ContentToBackgroundMessage) => {
        assertCurrent();
        const response = await chrome.runtime.sendMessage(msg);
        if (!response?.ok) throw new Error(response?.error ?? 'スキャン結果を反映できませんでした');
      };
      const timeout = setTimeout(() => controller?.abort(new Error('実行時間の上限（2分）に到達しました')), SCAN_TOOL_MAX_DURATION_MS);
      const onPageHide = () => controller?.abort();
      window.addEventListener('pagehide', onPageHide, { once: true });
      void (async () => {
        try {
          assertCurrent();
          if (message.tool === 'dimensions') {
            await probeDimensions({ urls: message.urls, signal,
              onDimension: (url, naturalWidth, naturalHeight) => send({
                channel: 'WIC_CONTENT_TO_BG', type: 'CONTENT_IMAGE_LOADED_DIMENSIONS',
                scanEpoch: message.scanEpoch, url, naturalWidth, naturalHeight,
              }),
              onProgress: (current, total, failed) => {
                assertCurrent(); report({ current, total, failed, message: `寸法を取得中 ${current} / ${total}件` });
              },
            });
          } else if (message.tool === 'scroll') {
            await scrollPage(signal, (current) => { assertCurrent(); report({ current, message: `自動スクロール中（${current}回）` }); });
          } else if (message.tool === 'pages') {
            let order = message.orderStart;
            const parse = (doc: Document, url: string) => {
              const ctx: ExtractorContext = { baseUri: url, elementIdMap: new WeakMap(),
                nextElementId: () => ++order, domOrderCounter: () => ++order,
                largeDataUrlStore: options.largeDataUrlStore };
              return parseCollectionDocument(doc, url, ctx);
            };
            const limited = await collectPages({ initial: parse(document, message.pageUrl), signal,
              readPage: async (url) => {
                assertCurrent();
                const request = new AbortController();
                const abort = () => request.abort(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
                const timer = setTimeout(() => request.abort(new Error('ページ取得がタイムアウトしました')), 15_000);
                try {
                  const response = await fetch(url, { credentials: 'include', redirect: 'error', signal: request.signal });
                  if (!response.ok) { await response.body?.cancel(); throw new Error(`ページを取得できませんでした (HTTP ${response.status})`); }
                  const html = await readTextLimited(response, PAGE_COLLECTION_HTML_MAX_CHARS);
                  if (html.length >= PAGE_COLLECTION_HTML_MAX_CHARS) throw new Error('ページの容量が上限を超えています');
                  assertCurrent();
                  return parse(new DOMParser().parseFromString(html, 'text/html'), response.url || url);
                } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
              },
              onPage: async (page) => {
                for (let i = 0; i < page.groups.length; i += SCAN_BATCH_MAX_SIZE) {
                  await send({ channel: 'WIC_CONTENT_TO_BG', type: 'CONTENT_SCAN_BATCH', scanEpoch: message.scanEpoch,
                    pageUrl: message.pageUrl, groups: page.groups.slice(i, i + SCAN_BATCH_MAX_SIZE) });
                }
              },
              onProgress: (current, total, images) => report({ current, total, message: `別ページを収集中 ${current} / ${total}ページ（画像${images}件）` }),
            });
            report({ status: 'completed', message: `${progress.message.replace('収集中', '収集完了')}${limited ? '・収集上限に到達' : ''}` });
            return;
          } else throw new Error('不明な追加スキャンです');
          report({ status: 'completed', message: message.tool === 'dimensions'
            ? `寸法取得完了 ${progress.current}件（取得不可 ${progress.failed ?? 0}件）` : '自動スクロール完了' });
        } catch (error) {
          const stopped = (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'AbortError') ||
            (error instanceof DOMException && error.name === 'AbortError');
          controller?.abort(); // A failed worker must also stop its sibling image probes.
          report({ status: stopped ? 'stopped' : 'failed',
            message: stopped ? '追加スキャンを停止しました' : error instanceof Error ? error.message : String(error) });
        } finally {
          clearTimeout(timeout); window.removeEventListener('pagehide', onPageHide);
          if (active === controller) active = undefined;
        }
      })();
    });
  };
  return { attach, stop };
}

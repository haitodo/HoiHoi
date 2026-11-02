import { BLOB_STREAM_CHUNK_BYTES, PORT_NAMES } from '@shared/constants';
import { readTextLimited } from '@shared/response-utils';
import type {
  BlobDataUrlResponse,
  BlobStreamPortMessage,
  VideoBlobPrepareResponse,
} from '@shared/messages';

/**
 * On-demand reader for page-origin `blob:` URLs (`design.md` §7.4, `video_mode_design.md` §5.2).
 *
 * STRICT INVARIANT: Functions in this module MUST NEVER be called during scanning or list rendering.
 * They run exclusively after the user explicitly clicks a Download or Resolve Stream button.
 */
export async function readBlobAsDataUrl(
  blobUrl: string,
  maxBytes: number,
): Promise<BlobDataUrlResponse> {
  let response: Response;
  try {
    response = await fetch(blobUrl);
  } catch (err) {
    throw new Error(
      `blob URLの読み込みに失敗しました (URL失効またはアクセス不可): ${String(err)}`,
    );
  }

  if (!response.ok && response.status !== 0) {
    // blob URLs often return status 0 or 200 on success
    throw new Error(`blob URLのフェッチステータスが異常です: ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new Error(
      `サイズ (${(blob.size / (1024 * 1024)).toFixed(1)}MB) が上限 (${(maxBytes / (1024 * 1024)).toFixed(0)}MB) を超えているため保存できません`,
    );
  }

  const dataUrl = await blobToDataUrl(blob);

  return {
    dataUrl,
    mimeType: blob.type || 'image/png',
    byteLength: blob.size,
  };
}

/**
 * Resolves a page-origin video `blob:` URL strictly on explicit user download trigger.
 * - Rejects MSE (`MediaSource`) virtual URLs cleanly.
 * - Returns inline Data URL for small/medium blobs (<= 16 MB).
 * - Streams 4 MB chunks over an extension Port to Side Panel for large blobs (up to 1 GB).
 */
export async function prepareOrStreamVideoBlob(options: {
  blobUrl: string;
  transferId: string;
  inlineMaxBytes: number;
  absoluteMaxBytes: number;
  recipientPanelId?: string;
}): Promise<VideoBlobPrepareResponse> {
  const { blobUrl, transferId, inlineMaxBytes, absoluteMaxBytes } = options;

  let response: Response;
  try {
    response = await fetch(blobUrl);
  } catch {
    const err = new Error(
      'この blob: URL は分割ストリーミング再生用 (MSE) または有効期限切れのため、単一動画ファイルとして保存できません',
    );
    (err as Error & { code?: string }).code = 'MSE_OR_EXPIRED_BLOB';
    throw err;
  }

  if (!response.ok && response.status !== 0) {
    throw new Error(`動画 blob の取得に失敗しました (status: ${response.status})`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    const err = new Error('動画データが空か、MSE仮想ストリームのため保存できません');
    (err as Error & { code?: string }).code = 'MSE_OR_EXPIRED_BLOB';
    throw err;
  }

  if (blob.size > absoluteMaxBytes) {
    throw new Error(
      `動画サイズ (${(blob.size / (1024 * 1024)).toFixed(1)}MB) が上限 (${(absoluteMaxBytes / (1024 * 1024)).toFixed(0)}MB) を超えています`,
    );
  }

  const mimeType = blob.type || 'video/mp4';

  if (blob.size <= inlineMaxBytes) {
    const dataUrl = await blobToDataUrl(blob);
    return {
      mode: 'inline_data_url',
      dataUrl,
      mimeType,
      byteLength: blob.size,
    };
  }

  // Large video blob (> 16 MB): stream 4 MB slices to Side Panel via Port
  const port = chrome.runtime.connect({ name: options.recipientPanelId
    ? `${PORT_NAMES.BLOB_STREAM}:${options.recipientPanelId}` : PORT_NAMES.BLOB_STREAM });
  let awaiting: { index: number; resolve: () => void; reject: (error: Error) => void } | null = null;
  port.onMessage.addListener((message: BlobStreamPortMessage) => {
    if (message.transferId !== transferId) return;
    if (message.type === 'BLOB_STREAM_ACK' && awaiting?.index === message.index) awaiting.resolve();
    if (message.type === 'BLOB_STREAM_ERROR') awaiting?.reject(new Error(message.error));
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    awaiting?.reject(new Error('保存パネルとの接続が切断されました'));
  });
  const postAndWait = (message: BlobStreamPortMessage, index: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('保存パネルからの応答がありません')), 15_000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      awaiting = null;
      if (error) reject(error); else resolve();
    };
    awaiting = { index, resolve: () => finish(), reject: (error) => finish(error) };
    try { port.postMessage(message); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
  try {
    const initMsg: BlobStreamPortMessage = {
      type: 'BLOB_STREAM_INIT',
      transferId,
      mimeType,
      totalBytes: blob.size,
    };
    await postAndWait(initMsg, -1);

    let offset = 0;
    let chunkIndex = 0;
    while (offset < blob.size) {
      const end = Math.min(offset + BLOB_STREAM_CHUNK_BYTES, blob.size);
      const slice = blob.slice(offset, end, mimeType);
      const sliceDataUrl = await blobToDataUrl(slice);
      const commaIdx = sliceDataUrl.indexOf(',');
      const base64Chunk = commaIdx >= 0 ? sliceDataUrl.slice(commaIdx + 1) : sliceDataUrl;

      const chunkMsg: BlobStreamPortMessage = {
        type: 'BLOB_STREAM_CHUNK',
        transferId,
        index: chunkIndex++,
        base64Chunk,
      };
      await postAndWait(chunkMsg, chunkIndex - 1);
      offset = end;
    }

    const doneMsg: BlobStreamPortMessage = {
      type: 'BLOB_STREAM_COMPLETE',
      transferId,
    };
    await postAndWait(doneMsg, -2);
  } catch (err) {
    try {
      const errMsg: BlobStreamPortMessage = {
        type: 'BLOB_STREAM_ERROR',
        transferId,
        error: String(err),
      };
      port.postMessage(errMsg);
    } catch {}
    throw err;
  } finally {
    // Completion was acknowledged; no delayed disconnect or idle timer is necessary.
    port.disconnect();
  }

  return {
    mode: 'streamed_to_panel',
    transferId,
    mimeType,
    byteLength: blob.size,
  };
}

/**
 * Fetches text manifest (e.g. `.m3u8`) in page context ONLY when user explicitly triggers resolution analysis.
 */
export async function fetchTextOnDemand(url: string, maxChars = 512_000): Promise<string> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`マニフェストの取得に失敗しました (HTTP ${response.status})`);
  }
  return readTextLimited(response, maxChars);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader returned non-string result'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

import type { BlobDataUrlResponse } from '@shared/messages';

/**
 * On-demand reader for page-origin `blob:` URLs (`design.md` §7.4, Task C3).
 *
 * Runs inside the webpage origin (Content Script) where `window.fetch` has access
 * to page-created `blob:` URLs that the Background SW cannot touch directly due to cross-origin isolation.
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
      `画像サイズ (${(blob.size / (1024 * 1024)).toFixed(1)}MB) が上限 (${(maxBytes / (1024 * 1024)).toFixed(0)}MB) を超えているため保存できません`,
    );
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
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

  return {
    dataUrl,
    mimeType: blob.type || 'image/png',
    byteLength: blob.size,
  };
}

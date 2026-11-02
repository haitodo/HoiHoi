import { BUFFERED_VIDEO_MAX_BYTES } from '@shared/constants';

export interface CompletedMediaBuffer {
  objectUrl: string;
  totalBytes: number;
  dispose: () => Promise<void>;
}

export interface MediaBuffer {
  write(chunk: Uint8Array): Promise<void>;
  finish(mimeType: string): Promise<CompletedMediaBuffer>;
  abort(): Promise<void>;
}

/** User-triggered only. OPFS scratch files avoid accumulating large videos in JS arrays. */
export async function createMediaBuffer(maxBytes: number): Promise<MediaBuffer> {
  let directory: FileSystemDirectoryHandle | undefined;
  let filename: string | undefined;
  let file: FileSystemFileHandle | undefined;
  let writer: FileSystemWritableFileStream | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      directory = await root.getDirectoryHandle('hoihoi-media', { create: true });
      filename = crypto.randomUUID();
      file = await directory.getFileHandle(filename, { create: true });
      writer = await file.createWritable();
    }
  } catch {
    if (directory && filename) await directory.removeEntry(filename).catch(() => {});
    directory = undefined;
    filename = undefined;
    file = undefined;
    writer = undefined;
  }

  const byteLimit = writer ? maxBytes : Math.min(maxBytes, BUFFERED_VIDEO_MAX_BYTES);
  let bytes = 0;
  let chunks: Blob[] = [];
  let closed = false;
  const removeFile = async () => {
    if (directory && filename) await directory.removeEntry(filename).catch(() => {});
  };

  return {
    async write(chunk) {
      if (closed) throw new Error('保存先はすでに閉じられています');
      if (bytes + chunk.byteLength > byteLimit) {
        throw new Error(writer ? '動画の保存サイズ上限を超えました' :
          '一時ファイルを利用できないため、64MBを超える動画は結合できません。yt-dlp コマンドをご利用ください');
      }
      bytes += chunk.byteLength;
      if (writer) await writer.write(chunk as Uint8Array<ArrayBuffer>);
      else chunks.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
    },
    async finish(mimeType) {
      if (closed) throw new Error('保存先はすでに閉じられています');
      closed = true;
      let blob: Blob;
      if (writer && file) {
        await writer.close();
        blob = await file.getFile();
      } else {
        blob = new Blob(chunks, { type: mimeType });
        chunks = [];
      }
      return { objectUrl: URL.createObjectURL(blob), totalBytes: bytes, dispose: removeFile };
    },
    async abort() {
      chunks = [];
      await writer?.abort().catch(() => {});
      closed = true;
      await removeFile();
    },
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaBuffer } from '../media-buffer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function opfs() {
  const chunks: BlobPart[] = [];
  const writer = { write: vi.fn(async (chunk) => { chunks.push(chunk); }),
    close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const file = { createWritable: vi.fn(async () => writer), getFile: vi.fn(async () => new Blob(chunks)) };
  const directory = { getFileHandle: vi.fn(async () => file), removeEntry: vi.fn(async () => {}) };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result');
  return { writer, file, directory };
}

describe('media buffer', () => {
  it('writes chunks to disk before accepting the next and removes the temporary file on disposal', async () => {
    const { writer, directory } = opfs();
    const sink = await createMediaBuffer(1000);
    await sink.write(new Uint8Array([1, 2]));
    await sink.write(new Uint8Array([3]));
    expect(writer.write).toHaveBeenCalledTimes(2);
    const result = await sink.finish('video/mp4');
    expect(result.totalBytes).toBe(3);
    expect(writer.close).toHaveBeenCalledOnce();
    expect(directory.removeEntry).not.toHaveBeenCalled();
    await result.dispose();
    expect(directory.removeEntry).toHaveBeenCalledOnce();
  });

  it('aborts the writable and removes partial data after failure/cancellation', async () => {
    const { writer, directory } = opfs();
    const sink = await createMediaBuffer(10);
    await sink.write(new Uint8Array([1]));
    await sink.abort();
    expect(writer.abort).toHaveBeenCalledOnce();
    expect(directory.removeEntry).toHaveBeenCalledOnce();
    await expect(sink.write(new Uint8Array([2]))).rejects.toThrow();
  });

  it('uses a bounded fallback when OPFS is unavailable and rejects bytes before retention', async () => {
    vi.stubGlobal('navigator', {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback');
    const sink = await createMediaBuffer(4);
    await sink.write(new Uint8Array([1, 2, 3]));
    await expect(sink.write(new Uint8Array([4, 5]))).rejects.toThrow();
    const result = await sink.finish('video/mp4');
    expect(result.totalBytes).toBe(3);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

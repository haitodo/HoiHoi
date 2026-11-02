import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOrStreamVideoBlob } from '../blob-reader';

describe('blob transfer backpressure', () => {
  let receive: (message: unknown) => void;
  let disconnect: () => void;
  let port: { postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    port = { postMessage: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => ({ ...port,
      onMessage: { addListener: (callback: typeof receive) => { receive = callback; } },
      onDisconnect: { addListener: (callback: typeof disconnect) => { disconnect = callback; } },
    })) } });
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, blob: async () => blob })));
    vi.stubGlobal('FileReader', class {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,AQID`;
        this.onloadend?.();
      }
    });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits for initialization/chunk/completion acknowledgments and leaves no timer after completion', async () => {
    const pending = prepareOrStreamVideoBlob({ blobUrl: 'blob:source', transferId: 'one',
      inlineMaxBytes: 1, absoluteMaxBytes: 100, recipientPanelId: 'panel-one' });
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'hoihoi-blob-stream:panel-one' });
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    receive({ type: 'BLOB_STREAM_ACK', transferId: 'one', index: -1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'BLOB_STREAM_CHUNK', index: 0 }));
    receive({ type: 'BLOB_STREAM_ACK', transferId: 'one', index: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'BLOB_STREAM_COMPLETE', transferId: 'one' });
    receive({ type: 'BLOB_STREAM_ACK', transferId: 'one', index: -2 });
    await expect(pending).resolves.toMatchObject({ mode: 'streamed_to_panel', byteLength: 3 });
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops reading if the recipient disconnects', async () => {
    const pending = prepareOrStreamVideoBlob({ blobUrl: 'blob:source', transferId: 'one', inlineMaxBytes: 1, absoluteMaxBytes: 100 });
    const rejected = expect(pending).rejects.toThrow('接続が切断');
    await vi.advanceTimersByTimeAsync(0);
    disconnect();
    await rejected;
    expect(port.postMessage.mock.calls.filter(([message]) => message.type === 'BLOB_STREAM_CHUNK')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

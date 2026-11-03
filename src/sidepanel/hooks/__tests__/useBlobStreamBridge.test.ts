import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_INSTANCE_ID } from '../../panel-instance';
import { PORT_NAMES } from '@shared/constants';

const hook = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({ useEffect: (effect: () => (() => void)) => { hook.cleanup = effect(); } }));
import { useBlobStreamBridge } from '../useBlobStreamBridge';

function event() {
  const listeners = new Set<(...args: any[]) => unknown>();
  return { addListener: (callback: (...args: any[]) => unknown) => listeners.add(callback),
    removeListener: (callback: (...args: any[]) => unknown) => listeners.delete(callback),
    emit: (...args: any[]) => [...listeners].map((callback) => callback(...args)), size: () => listeners.size };
}

describe('panel transfer isolation', () => {
  let connections: ReturnType<typeof event>;
  let messages: ReturnType<typeof event>;

  beforeEach(() => {
    connections = event(); messages = event();
    vi.stubGlobal('window', { setInterval });
    vi.stubGlobal('chrome', { runtime: { onConnect: connections, onMessage: messages, sendMessage: vi.fn(async () => {}) } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]),
      { headers: { 'content-type': 'video/mp4', 'content-length': '3' } })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:isolated');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    useBlobStreamBridge();
  });
  afterEach(() => { hook.cleanup?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function connect(name = `${PORT_NAMES.BLOB_STREAM}:${PANEL_INSTANCE_ID}`) {
    const port = { name, onMessage: event(), onDisconnect: event(), postMessage: vi.fn() };
    connections.emit(port);
    return port;
  }

  it('ignores other panels rather than duplicating fetches or decoding their streams', () => {
    const response = vi.fn();
    expect(messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_FETCH_HTTP_MEDIA_TO_OBJECT_URL', mediaMode: 'video',
      recipientPanelId: 'another-panel', tabId: 1, itemId: 'vid_1', transferId: 'one', url: 'https://example.com/a.mp4', maxBytes: 100 },
    {}, response)).toEqual([false]);
    expect(fetch).not.toHaveBeenCalled();
    expect(response).not.toHaveBeenCalled();
    expect(connect(`${PORT_NAMES.BLOB_STREAM}:another-panel`).onMessage.size()).toBe(0);
  });

  function fetchImage(maxBytes = 100) {
    const response = vi.fn();
    messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_FETCH_HTTP_MEDIA_TO_OBJECT_URL',
      mediaMode: 'image', recipientPanelId: PANEL_INSTANCE_ID, tabId: 1, itemId: 'item_1',
      transferId: 'photo', url: 'https://cdn.v2ph.com/photos/example.jpg?signature=keep', maxBytes }, {}, response);
    return response;
  }

  it('fetches images with cookies and preserves their original bytes and MIME type', async () => {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
    const response = fetchImage();
    await vi.waitFor(() => expect(response).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('https://cdn.v2ph.com/photos/example.jpg?signature=keep',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(response).toHaveBeenCalledWith({ ok: true, data: expect.objectContaining({
      mode: 'object_url', mimeType: 'image/jpeg', totalBytes: bytes.length,
    }) });
    messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_REVOKE_OBJECT_URL',
      objectUrl: 'blob:isolated' }, {}, vi.fn());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:isolated');
  });

  it.each([
    [403, 'text/plain', 'HTTP_403'],
    [200, 'text/html; charset=utf-8', 'HTML_RESPONSE'],
  ])('rejects image error responses (%s, %s) without creating a file', async (status, mime, code) => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ cancel }),
      { status, headers: { 'content-type': mime } }));
    const response = fetchImage();
    await vi.waitFor(() => expect(response).toHaveBeenCalled());
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('stops buffering images at the byte limit even without Content-Length', async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); }, cancel,
    }), { headers: { 'content-type': 'image/jpeg' } }));
    const response = fetchImage(2);
    await vi.waitFor(() => expect(response).toHaveBeenCalled());
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true,
      data: expect.objectContaining({ mode: 'direct_url_fallback' }) }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('acknowledges bounded chunks and exposes only the completed stream to its owner', () => {
    const port = connect();
    port.onMessage.emit({ type: 'BLOB_STREAM_INIT', transferId: 'one', totalBytes: 3, mimeType: 'video/mp4' });
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'BLOB_STREAM_ACK', transferId: 'one', index: -1 });
    port.onMessage.emit({ type: 'BLOB_STREAM_CHUNK', transferId: 'one', index: 0, base64Chunk: 'AQID' });
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'BLOB_STREAM_ACK', transferId: 'one', index: 0 });
    port.onMessage.emit({ type: 'BLOB_STREAM_COMPLETE', transferId: 'one' });
    const response = vi.fn();
    messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_CREATE_OBJECT_URL_FROM_TRANSFER',
      recipientPanelId: PANEL_INSTANCE_ID, transferId: 'one' }, {}, response);
    expect(response).toHaveBeenCalledWith({ ok: true, data: 'blob:isolated' });
  });

  it('rejects incomplete transfers promptly when the source tab disconnects', () => {
    const port = connect();
    port.onMessage.emit({ type: 'BLOB_STREAM_INIT', transferId: 'one', totalBytes: 3 });
    const response = vi.fn();
    messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_CREATE_OBJECT_URL_FROM_TRANSFER',
      recipientPanelId: PANEL_INSTANCE_ID, transferId: 'one' }, {}, response);
    port.onDisconnect.emit();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('cancels a large HTTP response before buffering it', async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ cancel }),
      { headers: { 'content-type': 'video/mp4', 'content-length': '1000' } }));
    const response = vi.fn();
    messages.emit({ channel: 'WIC_BG_TO_PANEL_RPC', type: 'PANEL_FETCH_HTTP_MEDIA_TO_OBJECT_URL', mediaMode: 'video',
      recipientPanelId: PANEL_INSTANCE_ID, tabId: 1, itemId: 'vid_1', transferId: 'one', url: 'https://example.com/a.mp4', maxBytes: 100 },
    {}, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalled());
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true, data: expect.objectContaining({ mode: 'direct_url_fallback' }) }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

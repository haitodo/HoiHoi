import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadAndAssembleHlsVod } from '../hls-saver';
import { createMediaBuffer } from '../media-buffer';
import { registerSidePanelObjectUrl } from '../../hooks/useBlobStreamBridge';

vi.mock('../media-buffer', () => ({ createMediaBuffer: vi.fn() }));
vi.mock('../../hooks/useBlobStreamBridge', () => ({ registerSidePanelObjectUrl: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const manifest = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\na.ts\n#EXTINF:10,\nb.ts\n#EXT-X-ENDLIST\n';
function setup() {
  const sink = { write: vi.fn(async () => {}), finish: vi.fn(async () => ({
    objectUrl: 'blob:hls', totalBytes: 4, dispose: vi.fn(async () => {}),
  })), abort: vi.fn(async () => {}) };
  vi.mocked(createMediaBuffer).mockResolvedValue(sink);
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith('.m3u8') ? manifest : new Uint8Array([1, 2])));
  vi.stubGlobal('fetch', fetcher);
  return { sink, fetcher };
}

describe('streamed HLS saving', () => {
  it('writes segments in order and registers temporary-file cleanup with the download', async () => {
    const { sink, fetcher } = setup();
    const result = await downloadAndAssembleHlsVod({ tabId: 0,
      manifestUrl: 'https://example.com/video.m3u8', signal: new AbortController().signal });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/video.m3u8', 'https://example.com/a.ts', 'https://example.com/b.ts',
    ]);
    expect(sink.write).toHaveBeenCalledTimes(2);
    expect(result.totalBytes).toBe(4);
    expect(registerSidePanelObjectUrl).toHaveBeenCalledWith('blob:hls', expect.any(Function));
    expect(sink.abort).not.toHaveBeenCalled();
  });

  it('stops later requests and removes partial files if a segment fails', async () => {
    const { sink, fetcher } = setup();
    fetcher.mockImplementation(async (url) => new Response(url.endsWith('.m3u8') ? manifest : '',
      { status: url.endsWith('a.ts') ? 500 : 200 }));
    await expect(downloadAndAssembleHlsVod({ tabId: 0, manifestUrl: 'https://example.com/video.m3u8',
      signal: new AbortController().signal })).rejects.toThrow('HTTP 500');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(sink.finish).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PORT_NAMES } from '@shared/constants';

const runner = vi.hoisted(() => ({ startOrRescan: vi.fn(), destroy: vi.fn() }));
vi.mock('../chunk-runner', () => ({ createChunkRunner: () => runner }));
vi.mock('../blob-reader', () => ({}));

function event() {
  const callbacks = new Set<(...args: any[]) => unknown>();
  return { addListener: (callback: (...args: any[]) => unknown) => callbacks.add(callback),
    removeListener: (callback: (...args: any[]) => unknown) => callbacks.delete(callback),
    emit: (...args: any[]) => callbacks.forEach((callback) => callback(...args)),
    size: () => callbacks.size };
}

describe('scanner ownership', () => {
  let messages: ReturnType<typeof event>;
  let connections: ReturnType<typeof event>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    messages = event();
    connections = event();
    vi.stubGlobal('window', { location: { href: 'https://example.com' } });
    vi.stubGlobal('chrome', { runtime: { id: 'test', onMessage: messages, onConnect: connections } });
    await import('../scanner');
  });

  function connect(epoch = 1) {
    const port = { name: PORT_NAMES.SCANNER_LIFECYCLE, onMessage: event(), onDisconnect: event(),
      disconnect() { this.onDisconnect.emit(); } };
    connections.emit(port);
    port.onMessage.emit({ type: 'SCANNER_WATCH', scanEpoch: epoch });
    return port;
  }

  it('does no scan until a panel directly watches the page', () => {
    messages.emit({ channel: 'WIC_BG_TO_CONTENT', type: 'BG_START_OR_RESCAN', scanEpoch: 2 }, {}, vi.fn());
    expect(runner.startOrRescan).not.toHaveBeenCalled();
    connect(2);
    expect(runner.startOrRescan).toHaveBeenCalledWith(2, true);
  });

  it('stops only after the last panel disconnects and resumes on demand', () => {
    const first = connect();
    const second = connect();
    expect(runner.startOrRescan).toHaveBeenCalledTimes(1);
    first.disconnect();
    expect(runner.destroy).not.toHaveBeenCalled();
    second.disconnect();
    expect(runner.destroy).toHaveBeenCalledTimes(1);
    connect();
    expect(runner.startOrRescan).toHaveBeenCalledTimes(2);
  });

  it('removes old listeners on reinjection', async () => {
    vi.resetModules();
    await import('../scanner');
    expect(messages.size()).toBe(1);
    expect(connections.size()).toBe(1);
  });
});

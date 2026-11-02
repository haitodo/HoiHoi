import { describe, expect, it, vi } from 'vitest';
import { readTextLimited } from '../response-utils';

describe('bounded text responses', () => {
  it('cancels the response as soon as its character limit is reached', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('abcdefghij')); }, cancel,
    }));
    expect(await readTextLimited(response, 5)).toBe('abcde');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('decodes UTF-8 characters split between chunks', async () => {
    const bytes = new TextEncoder().encode('日本語');
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
    } }));
    expect(await readTextLimited(response, 2)).toBe('日本');
  });
});

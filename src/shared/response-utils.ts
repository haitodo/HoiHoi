/** Read only the requested prefix, cancelling the rest instead of allocating an entire response. */
export async function readTextLimited(response: Response, maxChars: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) { text += decoder.decode(); break; }
      text += decoder.decode(value, { stream: true });
    }
    return text.slice(0, maxChars);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

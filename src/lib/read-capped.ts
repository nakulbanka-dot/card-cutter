/**
 * Read a response body as text, stopping after `maxChars`.
 *
 * `res.text().slice(0, n)` downloads the whole body before cutting it down.
 * Search results link to multi-megabyte PDFs and report archives as readily
 * as to articles, six pages are fetched at once, and the function has
 * already died once from running out of memory. Reading stops at the cap and
 * the rest of the download is cancelled.
 */
export async function readCapped(res: Response, maxChars: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    // Stop the rest of the download. Harmless when it already finished.
    reader.cancel().catch(() => {});
  }
  return text.slice(0, maxChars);
}

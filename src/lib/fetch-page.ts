import { extractMetadata } from "./metadata";
import { extractParagraphs } from "./html-text";
import type { ArticleMetadata } from "./citation";

/**
 * Fetch a page once and take everything from it.
 *
 * The pipeline used to pay for an extraction of every article and then
 * download the same page again itself to read the citation metadata. Each
 * article was fetched twice and billed once. This is the free half of that,
 * doing both jobs from one response.
 *
 * It does not replace the paid extraction — pages that render their text with
 * JavaScript, or that block automated requests, come back empty here and still
 * need it. It just means we only pay for the ones we cannot get ourselves.
 */

export interface FetchedPage {
  url: string;
  /** Article text, paragraphs joined. Empty when nothing usable was found. */
  body: string;
  metadata: ArticleMetadata;
  /** False when the page needs the paid extractor. */
  usable: boolean;
}

/** Below this there is no article here — a JS shell, a wall, or a stub. */
const MIN_USABLE_CHARS = 600;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
} as const;

function emptyMetadata(url: string): ArticleMetadata {
  return { authors: [], url, missing: ["author", "date", "title"] };
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) {
      return { url, body: "", metadata: emptyMetadata(url), usable: false };
    }
    // Articles can be megabytes of markup; the text is well inside this.
    html = (await res.text()).slice(0, 800_000);
  } catch {
    return { url, body: "", metadata: emptyMetadata(url), usable: false };
  }

  const metadata = extractMetadata(html, url);
  const body = extractParagraphs(html).join("\n\n");

  return {
    url,
    body,
    metadata,
    usable: body.trim().length >= MIN_USABLE_CHARS,
  };
}

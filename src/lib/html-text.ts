/**
 * Pull readable paragraphs out of raw HTML.
 *
 * Used for mining negatives: given the article a card came from, every
 * paragraph that is NOT the card is a paragraph the debater read and passed
 * over. Those are the negatives the corpus cannot provide, because every card
 * in it was cut.
 *
 * Plain fetch and plain parsing, so this costs nothing per article. It is
 * cruder than a paid extraction service and that is acceptable here: a few
 * missed paragraphs cost a few training rows, not a wrong answer to a user.
 */

/** Wholesale removals — these never contain article prose. */
const STRIP_BLOCKS =
  /<(script|style|noscript|svg|nav|header|footer|aside|form|figure|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Block elements whose text is worth keeping, in document order. */
const BLOCKS = /<(p|li|blockquote|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&lsquo;|&#8216;/g, "‘")
    .replace(/&ldquo;|&#8220;/g, "“")
    .replace(/&rdquo;|&#8221;/g, "”")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Strip inline tags and collapse whitespace. */
function toText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Cookie banners, share prompts, and subscription walls read like prose. */
const BOILERPLATE =
  /^(share this|sign up|subscribe|read more|advertisement|related:|photo:|image:|credit:|follow us|by continuing|we use cookies|accept all)/i;

export interface ExtractOptions {
  /** Below this a paragraph is a caption or a heading. */
  minChars?: number;
  /** Above this it is usually concatenated junk. */
  maxChars?: number;
}

export function extractParagraphs(
  html: string,
  { minChars = 180, maxChars = 3000 }: ExtractOptions = {},
): string[] {
  const cleaned = html.replace(STRIP_BLOCKS, " ");
  const out: string[] = [];
  const seen = new Set<string>();

  for (const m of cleaned.matchAll(BLOCKS)) {
    const text = toText(m[2]);
    if (text.length < minChars || text.length > maxChars) continue;
    if (BOILERPLATE.test(text)) continue;
    // Prose has sentences; a run of link text does not.
    if (!/[.!?]/.test(text)) continue;

    // Templates repeat the same promo paragraph in several places.
    const key = text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(text);
  }

  return out;
}

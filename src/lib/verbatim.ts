/**
 * Verbatim matching.
 *
 * The model hands back a quote it believes it copied from the article. We do
 * not trust that. We find the quote in the real article text and return the
 * article's own characters — so whatever the model typed is discarded and the
 * card body is, by construction, the author's words.
 *
 * Matching is tolerant of formatting drift (curly quotes, line wrapping,
 * em-dash style, casing) because extraction introduces that. It is NOT
 * tolerant of a different word, a dropped word, or a reordered clause — those
 * are the failures that matter.
 */

/** Normalized text plus a map from each normalized index back to the original. */
interface Normalized {
  text: string;
  /** map[i] = index in the original string that produced normalized char i. */
  map: number[];
}

/** Characters that extraction commonly rewrites, folded to an ASCII form. */
const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-",
  " ": " ", " ": " ", " ": " ", "​": "",
  "…": "...",
};

function normalize(input: string): Normalized {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const folded = FOLD[raw] ?? raw;

    if (folded === "") continue;

    if (/\s/.test(folded)) {
      // Collapse any run of whitespace to a single space, deferred so we
      // never emit a leading or trailing one.
      if (text.length > 0) pendingSpace = true;
      continue;
    }

    if (pendingSpace) {
      text += " ";
      map.push(i);
      pendingSpace = false;
    }

    // A fold may expand (… -> ...); every emitted char maps to the same source.
    for (const ch of folded.toLowerCase()) {
      text += ch;
      map.push(i);
    }
  }

  return { text, map };
}

export interface VerbatimMatch {
  /** The article's own characters. This is what goes on the card. */
  text: string;
  /** Offsets into the source text, so callers can locate or highlight it. */
  start: number;
  end: number;
}

/**
 * Find `quote` inside `source`. Returns the source's own text for the matched
 * span, or null if the quote does not actually appear — in which case the
 * caller must throw the card away.
 */
export function findVerbatim(
  source: string,
  quote: string,
): VerbatimMatch | null {
  if (!quote.trim()) return null;

  const haystack = normalize(source);
  const needle = normalize(quote);
  if (!needle.text) return null;

  const at = haystack.text.indexOf(needle.text);
  if (at === -1) return null;

  const start = haystack.map[at];
  const end = haystack.map[at + needle.text.length - 1] + 1;

  return { text: source.slice(start, end), start, end };
}

/** True if the quote appears in the source word-for-word. */
export function isVerbatim(source: string, quote: string): boolean {
  return findVerbatim(source, quote) !== null;
}

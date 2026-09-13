/**
 * Turning a debate claim into search terms, without a model.
 *
 * Free mode has no LLM, so query understanding is deliberately dumb: drop the
 * filler, keep the content words, and let Tavily's own relevance do the rest.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "have", "has", "had", "of", "to", "in", "on", "at",
  "by", "for", "with", "from", "as", "it", "its", "will", "would", "can",
  "could", "should", "may", "might", "must", "not", "no", "we", "i", "you",
  "they", "he", "she", "their", "our", "your", "about", "into", "over",
]);

/** Phrases debaters use to mean "find the other side". */
const NEGATION = [
  "answers to", "answer to", "at:", "a2:", "against", "refute", "refutes",
  "refuting", "response to", "responses to",
];

export interface ParsedQuery {
  /** Content words, lowercased and deduped. Used for scoring passages. */
  terms: string[];
  /** True if they asked for the other side. */
  wantsRefutation: boolean;
  /** What actually gets sent to the search engine. */
  searchQuery: string;
}

export function parseQuery(input: string): ParsedQuery {
  const lower = input.toLowerCase().trim();

  const wantsRefutation = NEGATION.some(
    (n) => lower.startsWith(n) || lower.includes(` ${n} `),
  );

  // Strip the jargon prefix so it doesn't pollute the search.
  let cleaned = lower;
  for (const n of NEGATION) {
    if (cleaned.startsWith(n)) {
      cleaned = cleaned.slice(n.length).trim();
      break;
    }
  }

  const terms = Array.from(
    new Set(
      cleaned
        .split(/[^a-z0-9'-]+/)
        .map((w) => w.replace(/^[''-]+|[''-]+$/g, ""))
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  );

  return {
    terms,
    wantsRefutation,
    // Tavily handles natural language, so send the cleaned phrase, not keywords.
    searchQuery: cleaned || input.trim(),
  };
}

/**
 * Search variants. Without a model we can't invent angles, but we can widen
 * the net in ways that reliably surface sourceable material.
 */
export function searchVariants(parsed: ParsedQuery): string[] {
  const base = parsed.searchQuery;
  const variants = [base];

  if (parsed.wantsRefutation) {
    variants.push(`evidence against ${base}`, `criticism of ${base}`);
  } else {
    variants.push(`${base} study evidence`, `${base} report data`);
  }

  return Array.from(new Set(variants));
}

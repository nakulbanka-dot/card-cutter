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

export interface ParsedQuery {
  /** Content words, lowercased and deduped. Used for scoring passages. */
  terms: string[];
  /** What actually gets sent to the search engine. */
  searchQuery: string;
}

export function parseQuery(input: string): ParsedQuery {
  const cleaned = input.toLowerCase().trim();

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
    // Tavily handles natural language, so send the cleaned phrase, not keywords.
    searchQuery: cleaned || input.trim(),
  };
}

/**
 * Search variants. Without a model we can't invent angles, but we can widen
 * the net in ways that reliably surface sourceable material.
 */
export function searchVariants(parsed: ParsedQuery): string[] {
  // Each variant is a separate search and a separate credit. Two is the
  // point where a third stopped adding sources that survived ranking, and on
  // a 1,000-credit month that difference is fifty searches.
  const base = parsed.searchQuery;
  return Array.from(new Set([base, `${base} study evidence`]));
}

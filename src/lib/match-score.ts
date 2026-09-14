/**
 * How well a source matches what you asked for.
 *
 * The earlier version scaled each source against the best one in the set, so
 * the top result was always 100% and the number said nothing about whether it
 * was any good — a set of eight bad sources still produced a confident 100%.
 *
 * This is absolute and decomposable. Each component is a fraction between 0
 * and 1 that can be shown to the user and argued with:
 *
 *   title    does the headline address the claim, not just mention it
 *   passage  do the terms land in the paragraph you would actually cut
 *   article  does the piece cover the topic at all
 *   density  are the terms throughout, or one passing reference
 *
 * Direction — whether the source argues your side — is the fifth component,
 * `support`, and it comes from the trained ranker. Without it the four
 * keyword components cannot tell a supporting source from an opposing one: a
 * piece titled "why nuclear is not the answer" matches a pro-nuclear query
 * almost perfectly on every one of them.
 *
 * It stays a single headline number. Direction and topic fail differently,
 * but a debater wants one figure to sort by, so the split lives in the
 * breakdown rather than in a second score to compare.
 */

export interface MatchBreakdown {
  title: number;
  passage: number;
  article: number;
  density: number;
  /**
   * Does the source argue the side the tag wanted. Undefined until a trained
   * ranker is available, in which case the topical components carry the score
   * on their own.
   */
  support?: number;
  /** Weighted total, 0-1. The one number shown. */
  score: number;
}

/**
 * Weights sum to 1 in both modes.
 *
 * With a support signal, direction takes the largest single share — it is the
 * thing keyword matching gets wrong, and the reason a source arguing the
 * opposite can top the results today.
 */
const KEYWORD_ONLY = { title: 0.3, passage: 0.4, article: 0.2, density: 0.1 };
const WITH_SUPPORT = {
  support: 0.35, title: 0.2, passage: 0.25, article: 0.13, density: 0.07,
};

/** Terms per thousand words at which density stops earning credit. */
const DENSITY_CEILING = 12;

/**
 * Word forms that should count as the same term.
 *
 * A tag says "nuclear solves warming"; the article says "nuclear solved" or
 * "solving". Matching on the literal string alone scores those as a miss,
 * which understates real sources and is not a judgment anyone would defend.
 * Light suffix handling only — no aggressive stemmer, which would start
 * matching words that are genuinely different.
 */
function variants(term: string): string[] {
  const out = new Set<string>([term]);
  const stem = term.replace(/(ies|es|s|ed|ing)$/, "");
  if (stem.length >= 3) {
    out.add(stem);
    for (const suffix of ["s", "es", "ed", "ing"]) out.add(stem + suffix);
    // "policies" -> "polic" -> "policy"
    if (term.endsWith("ies")) out.add(stem + "y");
  }
  return [...out];
}

function hasTerm(term: string, lowerText: string): boolean {
  return variants(term).some((v) => lowerText.includes(v));
}

function coverage(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  return terms.filter((t) => hasTerm(t, lower)).length / terms.length;
}

export function matchScore(
  terms: string[],
  { title, passage, article }: { title: string; passage: string; article: string },
  /** Probability from the trained ranker that this supports the tag. */
  support?: number,
): MatchBreakdown {
  const lowerTerms = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (lowerTerms.length === 0) {
    return { title: 0, passage: 0, article: 0, density: 0, score: 0 };
  }

  const titleScore = coverage(lowerTerms, title);
  const passageScore = coverage(lowerTerms, passage);
  const articleScore = coverage(lowerTerms, article);

  const words = article.split(/\s+/).filter(Boolean).length || 1;
  const lowerArticle = article.toLowerCase();
  const hits = lowerTerms.reduce((n, t) => {
    // Count the longest matching form only, so variants don't double-count.
    const form = variants(t).find((v) => lowerArticle.includes(v));
    return n + (form ? lowerArticle.split(form).length - 1 : 0);
  }, 0);
  const perThousand = (hits / words) * 1000;
  const density = Math.min(1, perThousand / DENSITY_CEILING);

  const hasSupport = typeof support === "number" && Number.isFinite(support);
  const w = hasSupport ? WITH_SUPPORT : KEYWORD_ONLY;

  let score =
    titleScore * w.title +
    passageScore * w.passage +
    articleScore * w.article +
    density * w.density;
  if (hasSupport) {
    score += Math.max(0, Math.min(1, support)) * WITH_SUPPORT.support;
  }

  return {
    title: titleScore,
    passage: passageScore,
    article: articleScore,
    density,
    ...(hasSupport ? { support: Math.max(0, Math.min(1, support)) } : {}),
    // Clamp defensively: a future weight change must not produce 103%.
    score: Math.max(0, Math.min(1, score)),
  };
}

export const asPercent = (n: number) => Math.round(n * 100);

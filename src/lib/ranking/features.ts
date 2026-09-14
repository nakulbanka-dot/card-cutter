/**
 * Feature extraction for the learned ranker.
 *
 * This file is the single implementation, used both when training on the
 * openCaselist corpus and when ranking live results. That is deliberate: if
 * training computed features in one language and inference in another, the two
 * would drift on some edge case and the model would quietly stop matching what
 * it learned, with no error to notice.
 *
 * Keep the vector append-only. Inserting a feature in the middle silently
 * reassigns every weight after it.
 */

export const FEATURE_NAMES = [
  "termCoverage",
  "termDensity",
  "logChars",
  "hasQuantity",
  "hasQuote",
  "hasCredential",
  "firstMatchPosition",
  "sentenceCount",
  "avgSentenceLen",
  "properNounRatio",
  "digitRatio",
  "hedgeRatio",
] as const;

export type FeatureVector = number[];

/** Words that mark an author's standing — a proxy for citability. */
const CREDENTIAL =
  /\b(professor|prof\.|ph\.?d|j\.?d\.|senior fellow|fellow at|director|analyst|researcher|economist|scholar|correspondent|editor|secretary|minister|chair(?:man|woman)?)\b/i;

/** Hedges. A passage that is all hedge says nothing worth reading aloud. */
const HEDGE =
  /\b(may|might|could|possibly|perhaps|arguably|potentially|seems|appears|suggests|likely|unlikely)\b/gi;

const QUANTITY =
  /\b\d{1,3}(,\d{3})*(\.\d+)?\s?(%|percent|billion|million|trillion|bn|tn)\b/i;

/** Normalize once; every feature reads from the same lowercased text. */
export function extractFeatures(terms: string[], text: string): FeatureVector {
  const chars = text.length;
  if (chars === 0) return FEATURE_NAMES.map(() => 0);

  const lower = text.toLowerCase();
  const lowerTerms = terms.map((t) => t.toLowerCase()).filter(Boolean);

  const matched = lowerTerms.filter((t) => lower.includes(t));
  const termCoverage = lowerTerms.length ? matched.length / lowerTerms.length : 0;

  const words = text.split(/\s+/).filter(Boolean);
  const hits = lowerTerms.reduce((n, t) => n + (lower.split(t).length - 1), 0);
  const termDensity = words.length ? (hits / words.length) * 100 : 0;

  // Where the first query term appears. Evidence that answers the tag up front
  // reads better aloud than evidence that gets there in the last sentence.
  let firstIndex = -1;
  for (const t of lowerTerms) {
    const at = lower.indexOf(t);
    if (at !== -1 && (firstIndex === -1 || at < firstIndex)) firstIndex = at;
  }
  const firstMatchPosition = firstIndex === -1 ? 1 : firstIndex / chars;

  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  const avgSentenceLen = sentences.length ? words.length / sentences.length : 0;

  // Proper nouns signal specificity — named institutions, statutes, places.
  const capitalized = words.filter((w) => /^[A-Z][a-z]/.test(w)).length;
  const properNounRatio = words.length ? capitalized / words.length : 0;

  const digits = (text.match(/\d/g) ?? []).length;
  const digitRatio = digits / chars;

  const hedges = (text.match(HEDGE) ?? []).length;
  const hedgeRatio = words.length ? hedges / words.length : 0;

  return [
    termCoverage,
    termDensity,
    Math.log1p(chars),
    QUANTITY.test(text) ? 1 : 0,
    /["“”]/.test(text) ? 1 : 0,
    CREDENTIAL.test(text) ? 1 : 0,
    firstMatchPosition,
    Math.log1p(sentences.length),
    avgSentenceLen,
    properNounRatio,
    digitRatio,
    hedgeRatio,
  ];
}

/** Tokenize a tag into query terms the same way the live search does. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "that", "this",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "have", "has", "had", "of", "to", "in", "on", "at",
  "by", "for", "with", "from", "as", "it", "its", "will", "would", "can",
  "could", "should", "may", "might", "must", "not", "no", "we", "i", "you",
  "they", "he", "she", "their", "our", "your", "about", "into", "over",
]);

export function termsFromTag(tag: string): string[] {
  return Array.from(
    new Set(
      tag
        .toLowerCase()
        .split(/[^a-z0-9'-]+/)
        .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  );
}

/** Standardize features so gradient descent converges. */
export interface Scaler {
  mean: number[];
  std: number[];
}

export function fitScaler(rows: FeatureVector[]): Scaler {
  const n = rows.length;
  const d = FEATURE_NAMES.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  if (n === 0) return { mean, std: std.map(() => 1) };

  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  for (const r of rows)
    for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2 / n;

  // A constant feature has zero variance; dividing by it would produce NaN.
  return { mean, std: std.map((v) => Math.sqrt(v) || 1) };
}

export function applyScaler(v: FeatureVector, s: Scaler): FeatureVector {
  return v.map((x, j) => (x - s.mean[j]) / s.std[j]);
}

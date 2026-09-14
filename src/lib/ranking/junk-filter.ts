import { CUTTABILITY_MODEL } from "../../data/cuttability-model.ts";
import { extractFeatures } from "./features.ts";
import { score } from "./logistic.ts";

/**
 * Reject paragraphs that are not prose.
 *
 * This model was trained on 62,928 paragraphs from 2,518 articles a debater
 * actually opened — the ones they cut against the ones they read and passed
 * over. As a ranker it is weak (AUC 0.651, no better than guessing the
 * majority), so it does not order results. At the bottom of its range it is
 * very good, and that is all it is used for.
 *
 * Measured on the training distribution:
 *
 *   drop the lowest  5%  ->  17 real cards lost out of 16,302   (0.1%)
 *   drop the lowest 10%  ->  291                                 (1.8%)
 *   drop the lowest 20%  ->  1,397                               (8.6%)
 *
 * Five percent is nearly free, so that is the threshold. What it removes is
 * citation strings, tables, and name-dense fragments — a legal footnote of
 * case cites scores 0.000. Those were never cuttable, and they crowd out
 * paragraphs that are.
 */

/** Score at the 5th percentile of the training distribution. */
const THRESHOLD = 0.0747;

const MODEL = CUTTABILITY_MODEL;

/** True when the paragraph is prose worth showing. */
export function isProse(terms: string[], text: string): boolean {
  try {
    return score(MODEL, extractFeatures(terms, text)) >= THRESHOLD;
  } catch {
    // A model mismatch must not silently swallow every passage.
    return true;
  }
}

/** How junk-like a paragraph is, for diagnostics. Lower is worse. */
export function proseScore(terms: string[], text: string): number {
  try {
    return score(MODEL, extractFeatures(terms, text));
  } catch {
    return 1;
  }
}

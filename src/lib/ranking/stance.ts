import type { ZeroShotClassificationPipeline } from "@huggingface/transformers";

/**
 * Does this passage support the claim, or argue against it?
 *
 * This is the one question keyword matching cannot answer, and it is the
 * reason an article titled "why nuclear is not the answer" could top a
 * pro-nuclear search. Two cheaper approaches were measured and rejected:
 *
 *   keyword features   an opposing source scores >90% — the words are identical
 *   sentence embeddings  the opposing passage scored HIGHER (0.550 vs 0.456),
 *                        and "solves" vs "does not solve" embed at 0.869
 *                        cosine, so negation barely moves the vector
 *
 * Natural language inference is the architecture built for it: given a passage
 * and a claim, a cross-encoder reads them together and decides entailment or
 * contradiction. Measured on the same example: supporting 0.734, opposing
 * 0.003, unrelated 0.166.
 *
 * Runs locally. The model is ~70MB, downloaded once and cached on disk.
 *
 * The runtime is loaded with a dynamic import rather than a static one. It
 * ships native ONNX binaries, and pulling those into the build graph made the
 * production build exceed the memory available on a normal laptop. Loading it
 * on first use keeps it out of the bundle entirely, and means the app still
 * builds and runs on a machine where the model is unavailable.
 */

const MODEL = "Xenova/nli-deberta-v3-xsmall";

/** Cross-encoders are quadratic in length; the opening is where a card argues. */
const MAX_CHARS = 1200;

let loading: Promise<ZeroShotClassificationPipeline> | null = null;
let failed = false;

async function getModel(): Promise<ZeroShotClassificationPipeline | null> {
  // One failure means no model on this machine; don't retry on every request.
  if (failed) return null;
  if (!loading) {
    loading = import("@huggingface/transformers").then(
      ({ pipeline }) =>
        pipeline("zero-shot-classification", MODEL) as Promise<ZeroShotClassificationPipeline>,
    );
  }
  try {
    return await loading;
  } catch {
    failed = true;
    loading = null;
    return null;
  }
}

/** Warm the model so the first real query doesn't pay the load. */
export function preloadStanceModel(): void {
  void getModel();
}

export interface StanceResult {
  /** 0-1. Higher means the passage argues the claim. */
  support: number;
}

/**
 * Score one passage against one claim.
 *
 * Returns null rather than a number when the model is unavailable — the
 * caller then falls back to keyword-only scoring, which is worse but honest.
 * A fabricated 0.5 would look like a real measurement.
 */
export async function scoreStance(
  claim: string,
  passage: string,
  wantsRefutation = false,
  /** The headline. Carries the article's thesis, which the passage may not. */
  title = "",
): Promise<StanceResult | null> {
  const model = await getModel();
  if (!model || !claim.trim() || !passage.trim()) return null;

  // Measured: a paragraph from an article arguing AGAINST the claim scored
  // 0.968 on its own, because it was describing the position it goes on to
  // reject. The same paragraph with its title prepended scored 0.010. A
  // passage read without its headline loses the framing that gives it sense.
  const text = title
    ? `${title}\n\n${passage}`.slice(0, MAX_CHARS)
    : passage.slice(0, MAX_CHARS);
  const supports = `This supports the claim that ${claim}.`;
  const contradicts = `This contradicts the claim that ${claim}.`;

  try {
    const out = await model(text, [supports, contradicts]);
    const result = Array.isArray(out) ? out[0] : out;
    const i = result.labels.indexOf(supports);
    if (i === -1) return null;

    const score = result.scores[i];
    // "Answers to X" wants sources that contradict X, so the useful passage is
    // the one that argues against the claim.
    return { support: wantsRefutation ? 1 - score : score };
  } catch {
    return null;
  }
}

/** Score several passages, bounded so one query can't pin the CPU. */
export async function scoreStanceBatch(
  claim: string,
  passages: { title: string; text: string }[],
  wantsRefutation = false,
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  // Sequential on purpose: the runtime is already multi-threaded internally,
  // and running these in parallel makes each slower rather than the set faster.
  for (const p of passages) {
    const r = await scoreStance(claim, p.text, wantsRefutation, p.title);
    out.push(r ? r.support : null);
  }
  return out;
}

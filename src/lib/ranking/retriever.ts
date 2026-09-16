import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Choosing which paragraphs the reranker gets to see.
 *
 * This is the shortlist, and until now it was keyword overlap — which set the
 * ceiling on the entire system. A paragraph arguing your tag in the author's
 * own words, sharing almost none of your vocabulary, was never a candidate, so
 * no amount of reranking could reach it. The reranker only ever judged what
 * counting words handed it.
 *
 * This model was trained on the corpus relationship itself: a tag, and the
 * passage a human judged sufficient to prove it. Measured on 362 held-out
 * article/tag pairs, searching each tag against all 9,299 test paragraphs:
 *
 *                         R@1      R@5     R@20     MRR
 *   keyword overlap      0.1740   0.3508   0.5580   0.2636
 *   this model           0.3232   0.6133   0.7707   0.4527
 *
 * Twice as likely to put the cut paragraph first. Inside a single article the
 * gap is much smaller (P@1 0.5912 vs 0.5884, which is inside the noise floor)
 * and that is expected — once you are already on the right page the author
 * uses the topic's vocabulary throughout, so counting words does fine. The
 * value is in finding the page.
 *
 * Runs locally on ONNX. The file is 22.9MB quantised, and R@1 measured
 * identical to full precision, so the deployed copy is the cheap one.
 */

/** Local ONNX build of the trained retriever. */
const MODEL_PATH = "models/retriever-onnx";

/** Cross-encoders are quadratic in length; a card argues in its opening. */
const MAX_CHARS = 1_200;

let loading: Promise<FeatureExtractionPipeline> | null = null;
let failed = false;

async function getModel(): Promise<FeatureExtractionPipeline | null> {
  // One failure means the model is not present on this machine. Retrying it
  // on every request turns a missing file into a slow request.
  if (failed) return null;
  if (!loading) {
    loading = import("@huggingface/transformers").then(({ pipeline, env }) => {
      // Load from disk only. A silent download at request time would make the
      // first search after a deploy take minutes for no visible reason.
      env.allowRemoteModels = false;
      env.localModelPath = "./";
      return pipeline("feature-extraction", MODEL_PATH, {
        dtype: "q8",
      }) as Promise<FeatureExtractionPipeline>;
    });
  }
  try {
    return await loading;
  } catch {
    failed = true;
    loading = null;
    return null;
  }
}

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors arrive L2-normalised
}

/**
 * Rank paragraphs against the claim, best first.
 *
 * Returns null — never a neutral ordering — when the model is unavailable, so
 * the caller can fall back to keyword scoring and say so. An arbitrary order
 * dressed up as a ranking is worse than an admitted fallback.
 */
export async function rankByMeaning(
  claim: string,
  passages: string[],
): Promise<number[] | null> {
  if (!claim.trim() || passages.length === 0) return null;

  const model = await getModel();
  if (!model) return null;

  try {
    const embed = async (texts: string[]) => {
      const out = await model(texts, { pooling: "mean", normalize: true });
      return out.tolist() as number[][];
    };

    const [q] = await embed([claim.slice(0, MAX_CHARS)]);
    const docs = await embed(passages.map((p) => p.slice(0, MAX_CHARS)));

    return docs.map((d) => cosine(d, q));
  } catch {
    return null;
  }
}

/** Whether the trained retriever is available, for reporting which path ran. */
export async function retrieverReady(): Promise<boolean> {
  return (await getModel()) !== null;
}

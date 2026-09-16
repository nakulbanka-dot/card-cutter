import type { PreTrainedModel, PreTrainedTokenizer } from "@huggingface/transformers";

/**
 * Does this paragraph prove the tag?
 *
 * Replaces the zero-shot NLI model that used to answer this. That model asked
 * whether the passage ENTAILS the claim, which is a different question and the
 * wrong one: a paragraph can entail a tag and be a throwaway summary line, and
 * a devastating card need not be a strict logical entailment of anything.
 * Measured on 362 held-out article/tag pairs, it ranked paragraphs worse than
 * counting keywords.
 *
 *                                AUC/article    P@1      R@4
 *   NLI stance (what shipped)       0.5792    0.4922   0.8264
 *   keyword (the app's own)         0.6459    0.5718   0.8591
 *   this model                      0.7247    0.6740   0.8978
 *   chance                                    0.3663
 *
 * Trained on the question the app actually asks: 224,732 cards, each a human
 * deciding that this passage proves this tag, against mined negatives of four
 * kinds — another card whose TAG looks nearly identical, a card from the
 * opposing side, a card from the same file, and random. One negative axis was
 * not enough; with only same-file negatives the second training epoch made the
 * model worse.
 *
 * Direction is not a separate stage here. No debater ever cut an opposing
 * paragraph under a tag, so "argues the other side" is learned from the data
 * rather than bolted on as its own question.
 */

/** Local ONNX build, quantised. Measured equal to fp32 on this test set. */
const MODEL_PATH = "reranker";

/** Cross-encoders are quadratic in length; a card argues in its opening. */
const MAX_CHARS = 1_200;

/** Scored in batches; larger batches mostly buy padding waste. */
const BATCH = 8;

/** Trained at 192 tokens; scoring longer than that is off-distribution. */
const MAX_TOKENS = 192;

/**
 * Loaded as model + tokenizer rather than through the text-classification
 * pipeline, which cannot express this model.
 *
 * That pipeline softmaxes over the label set to produce its score, and this
 * model has one output. Softmax of a single value is 1, so every passage came
 * back at exactly 1.000 — not an error, not a crash, just every candidate
 * scored identically and the ranking silently replaced by whatever order they
 * arrived in. The head is a single logit and wants a sigmoid.
 */
let loading: Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> | null = null;
let failed = false;
/** Why the model would not load. Surfaced so a fallback is never silent. */
let loadError: string | null = null;


/**
 * Off unless explicitly switched on.
 *
 * The first deploy with both models loaded crashed the function outright —
 * not an exception the route could catch and report, but the process going
 * away, which reaches the user as an HTML error page and a failed search.
 * Two ONNX runtimes plus the tensors for a few hundred paragraphs is a lot to
 * ask of a serverless function's memory.
 *
 * So the models are opt-in. Without the flag the app runs the keyword path it
 * ran before, which is worse and works. A broken search is worse than a
 * weaker one.
 */
function enabled(): boolean {
  return process.env.USE_TRAINED_MODELS === "1";
}

async function getModel() {
  if (!enabled()) return null;
  if (failed) return null;
  if (!loading) {
    loading = import("@huggingface/transformers").then(
      async ({ AutoModelForSequenceClassification, AutoTokenizer, env }) => {
        env.allowRemoteModels = false;
        env.localModelPath = "./ml/";
        const [model, tokenizer] = await Promise.all([
          AutoModelForSequenceClassification.from_pretrained(MODEL_PATH, { dtype: "q8" }),
          AutoTokenizer.from_pretrained(MODEL_PATH),
        ]);
        return { model, tokenizer };
      },
    );
  }
  try {
    return await loading;
  } catch (err) {
    failed = true;
    loading = null;
    loadError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return null;
  }
}

/** The load failure, if there was one. */
export function rerankerLoadError(): string | null {
  return loadError;
}

/** Whether the trained reranker is available, for reporting which path ran. */
export async function rerankerReady(): Promise<boolean> {
  return (await getModel()) !== null;
}

/**
 * Score passages against the claim. 0-1, higher means more cuttable.
 *
 * Null for a passage the model could not read, never a neutral 0.5 — a
 * fabricated number is indistinguishable from a measurement in the breakdown,
 * and the caller falls back to keyword scoring and says so.
 */
export async function scoreCuttable(
  claim: string,
  passages: { title: string; text: string }[],
): Promise<(number | null)[]> {
  if (passages.length === 0) return [];
  const loaded = await getModel();
  if (!loaded) return passages.map(() => null);
  const { model, tokenizer } = loaded;

  const out: (number | null)[] = new Array(passages.length).fill(null);

  for (let i = 0; i < passages.length; i += BATCH) {
    const chunk = passages.slice(i, i + BATCH);
    // The headline is prepended because it is how the model was trained: a
    // paragraph can spend its length describing the position its article goes
    // on to reject, and the title is what gives it sense.
    const texts = chunk.map((p) =>
      (p.title ? `${p.title}\n\n${p.text}` : p.text).slice(0, MAX_CHARS),
    );
    try {
      // Claim first, passage second — the order it was trained in. Swapping
      // them is silent: the model still returns numbers, just worse ones.
      const inputs = tokenizer(Array(chunk.length).fill(claim), {
        text_pair: texts,
        padding: true,
        truncation: true,
        max_length: MAX_TOKENS,
      });
      const { logits } = await model(inputs);
      const values = logits.sigmoid().tolist() as number[][];
      values.forEach((v, j) => {
        const score = Array.isArray(v) ? v[0] : (v as unknown as number);
        out[i + j] = typeof score === "number" ? score : null;
      });
    } catch {
      // Leave this batch null; a failed read is not a low score.
    }
  }
  return out;
}

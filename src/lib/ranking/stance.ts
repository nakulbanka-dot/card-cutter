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
 * Two ways to run it:
 *
 *   local   the ONNX model on this machine. Free, private, no network. The
 *           runtime is ~600MB installed, which is far past any serverless
 *           function limit, so this is the development path.
 *   remote  the same model behind Hugging Face's inference API. Nothing to
 *           bundle, so it deploys anywhere, at the cost of a network hop and
 *           a free API token.
 *
 * Remote is used when HUGGINGFACE_API_KEY is set, local otherwise. Neither
 * being available is fine — sources keep their keyword-only score, which is
 * worse but honest.
 *
 * The local runtime is loaded by dynamic import rather than a static one. Its
 * native ONNX binaries in the build graph made the production build exceed the
 * memory available on a normal laptop.
 */

const MODEL = "Xenova/nli-deberta-v3-xsmall";

/** Cross-encoders are quadratic in length; the opening is where a card argues. */
const MAX_CHARS = 1200;

let loading: Promise<ZeroShotClassificationPipeline> | null = null;
let failed = false;
/** Remote failures are usually transient; stop trying after a few in a row. */
let remoteFailures = 0;
const REMOTE_FAILURE_LIMIT = 5;

function remoteToken(): string | undefined {
  return process.env.HUGGINGFACE_API_KEY || undefined;
}

/**
 * Score via Hugging Face's hosted copy of the same model.
 *
 * Returns null on any failure rather than a neutral number: a fabricated 0.5
 * would be indistinguishable from a real measurement in the breakdown.
 */
async function scoreRemote(
  text: string,
  labels: string[],
): Promise<number[] | null> {
  const token = remoteToken();
  if (!token || remoteFailures >= REMOTE_FAILURE_LIMIT) return null;

  try {
    const res = await fetch(
      `https://api-inference.huggingface.co/models/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: text,
          parameters: { candidate_labels: labels, multi_label: true },
          // The model sleeps when idle; ask the API to wait rather than 503.
          options: { wait_for_model: true },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      remoteFailures++;
      return null;
    }

    const json = (await res.json()) as { labels?: string[]; scores?: number[] };
    if (!json.labels || !json.scores) {
      remoteFailures++;
      return null;
    }

    remoteFailures = 0;
    // The API reorders by score; put them back in the order asked for.
    return labels.map((l) => {
      const i = json.labels!.indexOf(l);
      return i === -1 ? 0 : json.scores![i];
    });
  } catch {
    remoteFailures++;
    return null;
  }
}

async function getModel(): Promise<ZeroShotClassificationPipeline | null> {
  // One failure means no model on this machine; don't retry on every request.
  if (failed) return null;
  // Hosted mode is handled before this is reached; don't pull 600MB into a
  // serverless function that will only be killed for it.
  if (remoteToken()) return null;
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
  /** The headline. Carries the article's thesis, which the passage may not. */
  title = "",
): Promise<StanceResult | null> {
  if (!claim.trim() || !passage.trim()) return null;

  // Measured: a paragraph from an article arguing AGAINST the claim scored
  // 0.968 on its own, because it was describing the position it goes on to
  // reject. The same paragraph with its title prepended scored 0.010. A
  // passage read without its headline loses the framing that gives it sense.
  const text = title
    ? `${title}\n\n${passage}`.slice(0, MAX_CHARS)
    : passage.slice(0, MAX_CHARS);
  const supports = `This supports the claim that ${claim}.`;
  const contradicts = `This contradicts the claim that ${claim}.`;

  // Hosted first when configured — the deployed app has no room for the
  // local runtime.
  if (remoteToken()) {
    const scores = await scoreRemote(text, [supports, contradicts]);
    if (scores) return { support: scores[0] };
    // Fall through: a dev machine may still have the local model.
  }

  const model = await getModel();
  if (!model) return null;

  try {
    const out = await model(text, [supports, contradicts]);
    const result = Array.isArray(out) ? out[0] : out;
    const i = result.labels.indexOf(supports);
    if (i === -1) return null;

    return { support: result.scores[i] };
  } catch {
    return null;
  }
}

/** Score several passages, bounded so one query can't pin the CPU. */
export async function scoreStanceBatch(
  claim: string,
  passages: { title: string; text: string }[],
): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  // Sequential on purpose: the runtime is already multi-threaded internally,
  // and running these in parallel makes each slower rather than the set faster.
  for (const p of passages) {
    const r = await scoreStance(claim, p.text, p.title);
    out.push(r ? r.support : null);
  }
  return out;
}

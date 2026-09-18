import type { PreTrainedModel, PreTrainedTokenizer } from "@huggingface/transformers";

/**
 * Which sentences of a passage would a debater underline?
 *
 * Trained on 211,555 sentences from the user's own cards, labelled from the
 * character spans they underlined by hand — the most direct supervision in the
 * dataset, and the only part of cutting that was still entirely manual.
 *
 * Measured on 36,000 held-out sentences from files the model never saw:
 *
 *   threshold   precision   recall   marks      humans marked
 *      0.3        0.528     0.756     53%           37%
 *      0.4        0.583     0.615     39%           37%
 *      0.5        0.639     0.466     27%           37%
 *
 * 0.4 because it underlines about as much as a person does. What that costs,
 * plainly: roughly four in ten of its marks are ones a debater would not have
 * made, and it misses about four in ten they would. That is a first pass to
 * edit, not a finished card, and the interface should not pretend otherwise.
 */

const MODEL_PATH = "highlighter";
const THRESHOLD = 0.4;
const BATCH = 16;
const MAX_TOKENS = 160;

/** Sentences shorter than this are fragments, not arguments. */
const MIN_WORDS = 5;

/**
 * Citation fragments that look like sentences.
 *
 * The training data had to exclude these and so does inference — debaters
 * underline into the cite, and the splitter breaks on the dots inside a URL,
 * so "https://www.example.org/article" arrives as several short "sentences".
 * Marked up, the card would come back with its link underlined.
 */
const CITE_MARKER =
  /https?:\/\/|www\.|\baccessed\b|\bdoa\b|\bretrieved\b|\bdoi\b|\/\/[a-z]{2,4}\b/i;

function isCiteFragment(t: string): boolean {
  if (CITE_MARKER.test(t)) return true;
  const noisy = (t.match(/[\d[\](){};:,/|—-]/g) ?? []).length;
  return noisy / Math.max(1, t.length) > 0.25;
}

export interface Sentence {
  text: string;
  start: number;
  end: number;
  /** 0-1 from the model; undefined when it could not be scored. */
  score?: number;
  /** Whether to underline it. */
  mark: boolean;
}

/** Split into sentences, keeping offsets so marks line up with the original. */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[^.!?]+(?:[.!?]+|$)/g)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.split(/\s+/).length < MIN_WORDS) continue;
    if (isCiteFragment(t)) continue;
    const start = m.index + lead;
    out.push({ text: t, start, end: start + t.length });
  }
  return out;
}

let loading: Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> | null = null;
let failed = false;
let loadError: string | null = null;

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

export function highlighterLoadError(): string | null {
  return loadError;
}

/**
 * Mark the sentences that do the argumentative work.
 *
 * Returns the sentences with no marks when the model is unavailable, rather
 * than null — an un-underlined card is still a card, and the caller can say
 * the pass did not run without withholding the passage itself.
 */
export async function markUnderlines(
  claim: string,
  passage: string,
): Promise<Sentence[]> {
  const parts = sentences(passage);
  if (parts.length === 0) return [];

  const loaded = await getModel();
  if (!loaded) return parts.map((p) => ({ ...p, mark: false }));
  const { model, tokenizer } = loaded;

  const out: Sentence[] = parts.map((p) => ({ ...p, mark: false }));

  for (let i = 0; i < parts.length; i += BATCH) {
    const chunk = parts.slice(i, i + BATCH);
    try {
      const inputs = tokenizer(Array(chunk.length).fill(claim), {
        text_pair: chunk.map((c) => c.text),
        padding: true,
        truncation: true,
        max_length: MAX_TOKENS,
      });
      const { logits } = await model(inputs);
      const values = logits.sigmoid().tolist() as number[][];
      values.forEach((v, j) => {
        const s = Array.isArray(v) ? v[0] : (v as unknown as number);
        if (typeof s === "number") {
          out[i + j].score = s;
          out[i + j].mark = s >= THRESHOLD;
        }
      });
    } catch {
      // Leave this batch unmarked rather than guessing at it.
    }
  }
  return out;
}

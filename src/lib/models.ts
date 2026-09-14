/**
 * Model + provider constants. Single place to change what the pipeline runs on.
 */

/**
 * Default cutting model — the only place this app spends Claude tokens.
 *
 * Haiku, for cost. Cutting is high volume: every source in every query is a
 * full-length call, so per-card cost decides whether the paid tier is viable.
 * Haiku roughly halves what Sonnet costs per card ($0.013 against $0.026 on a
 * 5,500-token article), and the work ahead of it now does more of the
 * filtering — the model only ever sees passages that have already been read
 * and ranked.
 *
 * Set CARD_CUTTER_MODEL=claude-sonnet-5 if the judgment turns out to matter
 * more than the saving. Nothing else needs to change; reasoning.ts already
 * sends each model the parameters it accepts.
 *
 * NOTE: reading passages does not run on Claude and costs no tokens. That is
 * an NLI cross-encoder (see ranking/stance.ts), free either locally or on
 * Hugging Face's free tier.
 */
export const CUTTING_MODEL = "claude-haiku-4-5" as const;

/** Where more judgment is worth paying for. Not the default. */
export const STRONG_MODEL = "claude-sonnet-5" as const;

/** Ceiling per cutting call. Streaming is required above ~32k. */
export const MAX_TOKENS = 16_000;

/** How many sources one 5–10 word query fans out to before we start cutting. */
export const DEFAULT_SOURCE_LIMIT = 8;

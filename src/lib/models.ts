/**
 * Model + provider constants. Single place to change what the pipeline runs on.
 */

/**
 * Default cutting model.
 *
 * Sonnet, not Opus. Cutting is high-volume — every source in every query is a
 * full-length call — so the per-card cost decides whether this is viable at
 * all. Sonnet holds up on "which paragraph is the warrant" while costing a
 * fraction of Opus per token, and the ranker is being trained to do the
 * filtering that would otherwise need a stronger model.
 *
 * Override with CARD_CUTTER_MODEL. `claude-haiku-4-5` is the cheap tier for
 * bulk work and smoke tests.
 */
export const CUTTING_MODEL = "claude-sonnet-5" as const;

/** Cheapest tier, for bulk passes and pre-filtering. */
export const BULK_MODEL = "claude-haiku-4-5" as const;

/** Ceiling per cutting call. Streaming is required above ~32k. */
export const MAX_TOKENS = 16_000;

/** How many sources one 5–10 word query fans out to before we start cutting. */
export const DEFAULT_SOURCE_LIMIT = 8;

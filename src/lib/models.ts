/**
 * Model + provider constants. Single place to change what the pipeline runs on.
 */

/**
 * Default reasoning model. Reading a 4,000-word article and deciding which
 * sentence is the warrant is a judgment call, so this is deliberately the
 * strong model rather than the cheap one.
 */
export const CUTTING_MODEL = "claude-opus-5" as const;

/** Ceiling per cutting call. Streaming is required above ~32k. */
export const MAX_TOKENS = 16_000;

/** How many sources one 5–10 word query fans out to before we start cutting. */
export const DEFAULT_SOURCE_LIMIT = 8;

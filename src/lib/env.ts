import { z } from "zod";
import { DEFAULT_SOURCE_LIMIT } from "./models";

/**
 * Server-side environment.
 *
 * Only the Tavily key is required. Free mode — search, extract, rank passages —
 * runs without Anthropic entirely, so demanding that key up front would lock
 * people out of the part that costs nothing.
 */
const schema = z.object({
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is not set"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CARD_CUTTER_MODEL: z.string().optional(),
  CARD_CUTTER_SOURCE_LIMIT: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Throws a readable error if the Tavily key is missing. Server-only. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** True when paid cutting is available. */
export function hasAnthropicKey(): boolean {
  return Boolean(getEnv().ANTHROPIC_API_KEY);
}

/** For the paid path only. Fails with an instruction rather than a stack trace. */
export function requireAnthropicKey(): string {
  const key = getEnv().ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "Cutting needs ANTHROPIC_API_KEY in .env.local. Free mode (search and extract) works without it.",
    );
  }
  return key;
}

/**
 * How many articles one query reads. In free mode this is just extraction
 * calls; in paid mode each source is also a full-length model call.
 */
export function defaultSourceLimit(): number {
  const raw = getEnv().CARD_CUTTER_SOURCE_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : DEFAULT_SOURCE_LIMIT;
}

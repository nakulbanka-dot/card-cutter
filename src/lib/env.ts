import { z } from "zod";
import { DEFAULT_SOURCE_LIMIT } from "./models";

/**
 * Server-side environment.
 *
 * Neither key is required.
 *
 * Tavily's keyless mode supports search and extract — exactly the two calls
 * free mode makes — subject to hourly/daily/monthly caps. So the app runs with
 * no account at all; adding a free Tavily key just raises the ceiling.
 */
const schema = z.object({
  TAVILY_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  CARD_CUTTER_MODEL: z.string().optional(),
  CARD_CUTTER_SOURCE_LIMIT: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Server-only. Never throws for a missing key — keyless is a valid mode. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** True when a Tavily key is set. Without one we run keyless, under tighter caps. */
export function hasTavilyKey(): boolean {
  return Boolean(getEnv().TAVILY_API_KEY);
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

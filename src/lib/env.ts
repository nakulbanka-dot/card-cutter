import { z } from "zod";
import { DEFAULT_SOURCE_LIMIT } from "./models";

/**
 * Server-side environment. Validated lazily so that `next build` and the
 * client bundle never require real keys to be present.
 */
const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is not set"),
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is not set"),
  CARD_CUTTER_MODEL: z.string().optional(),
  CARD_CUTTER_SOURCE_LIMIT: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Throws a readable error if a key is missing. Call only from server code. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/**
 * How many articles one query reads. This is the main cost dial: each source
 * is a full-length model call, so halving it roughly halves the bill.
 */
export function defaultSourceLimit(): number {
  const raw = getEnv().CARD_CUTTER_SOURCE_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : DEFAULT_SOURCE_LIMIT;
}

import { z } from "zod";

/**
 * Server-side environment. Validated lazily so that `next build` and the
 * client bundle never require real keys to be present.
 */
const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is not set"),
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is not set"),
  CARD_CUTTER_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Throws a readable error if a key is missing. Call only from server code. */
export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

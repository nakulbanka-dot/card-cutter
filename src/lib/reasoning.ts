import type Anthropic from "@anthropic-ai/sdk";

/**
 * Thinking configuration differs by model generation, and sending the wrong
 * shape is a 400 rather than a silent downgrade:
 *
 *   Opus 5 / 4.x, Sonnet 5 / 4.6   adaptive thinking + output_config.effort
 *   Haiku 4.5 and older            thinking.budget_tokens, no effort
 *
 * This keeps CARD_CUTTER_MODEL genuinely switchable — useful because Haiku is
 * roughly 5x cheaper and fine for checking that the pipeline is wired up.
 */

export type Effort = "low" | "medium" | "high";

export interface Reasoning {
  thinking: Anthropic.ThinkingConfigParam;
  /** Undefined on models where `effort` is rejected. */
  effort?: Effort;
}

/** Models that take a fixed thinking budget instead of adaptive thinking. */
function usesBudgetTokens(model: string): boolean {
  return /haiku|claude-3|sonnet-4-5|opus-4-5/.test(model);
}

export function reasoningFor(
  model: string,
  effort: Effort,
  maxTokens: number,
): Reasoning {
  if (!usesBudgetTokens(model)) {
    return { thinking: { type: "adaptive" }, effort };
  }

  // Must be >= 1024 and strictly less than max_tokens.
  const budget = Math.max(1024, Math.min(4_000, Math.floor(maxTokens / 2)));
  return { thinking: { type: "enabled", budget_tokens: budget } };
}

/** Spread into `output_config` alongside `format`, omitting effort when unsupported. */
export function effortConfig(r: Reasoning): { effort?: Effort } {
  return r.effort ? { effort: r.effort } : {};
}

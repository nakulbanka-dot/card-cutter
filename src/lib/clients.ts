import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { getEnv, requireAnthropicKey } from "./env";

let anthropicClient: Anthropic | undefined;
let tavilyClient: ReturnType<typeof tavily> | undefined;

export function anthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: requireAnthropicKey() });
  }
  return anthropicClient;
}

export function tavilyClientInstance(): ReturnType<typeof tavily> {
  if (!tavilyClient) {
    tavilyClient = tavily({ apiKey: getEnv().TAVILY_API_KEY });
  }
  return tavilyClient;
}

/** Model the cutting passes run on, overridable via env. */
export function cuttingModel(): string {
  return getEnv().CARD_CUTTER_MODEL ?? "claude-opus-5";
}

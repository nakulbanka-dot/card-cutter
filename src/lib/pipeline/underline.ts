import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, cuttingModel } from "../clients";
import { reasoningFor, effortConfig } from "../reasoning";
import { findVerbatim } from "../verbatim";
import type { Card, Underline } from "../types";

/**
 * Stage 5 — underline.
 *
 * Separate pass on purpose. "Find the evidence" and "compress it to eight
 * seconds of speech" are different judgments, and the model does both worse
 * when asked at once.
 *
 * The model returns phrases; we locate them in the card body ourselves, so a
 * phrase it subtly reworded simply fails to place rather than corrupting the
 * highlighting.
 */

const UnderlineSchema = z.object({
  /** Phrases copied from the body, in the order they appear. */
  phrases: z.array(z.string()).max(12),
});

const SYSTEM = `You underline a debate card — marking what gets read aloud.

You get a tag and a card body. Return the phrases from the body that must be
spoken for the tag to stand up. Everything unmarked gets skipped in round.

- Copy phrases character-for-character from the body. Anything that doesn't
  match the body exactly is dropped.
- Return them in the order they appear.
- Aim for 20-40% of the body. Underlining most of it defeats the point.
- Each phrase should be readable on its own; prefer a few substantial phrases
  over many fragments.
- Keep the words that carry the argument: the claim, the mechanism, the
  magnitude. Cut attribution, throat-clearing, and examples.
- Never underline across a gap in a way that reverses or misstates meaning.
  The underlined words read in sequence must be honest to the full passage.`;

export async function underline(card: Card): Promise<Underline[]> {
  const model = cuttingModel();
  const reasoning = reasoningFor(model, "medium", 4_000);

  const response = await anthropic().messages.parse({
    model,
    max_tokens: 4_000,
    system: SYSTEM,
    thinking: reasoning.thinking,
    output_config: { format: zodOutputFormat(UnderlineSchema), ...effortConfig(reasoning) },
    messages: [
      {
        role: "user",
        content: `TAG: ${card.tag}\n\nBODY:\n${card.body}`,
      },
    ],
  });

  const phrases = response.parsed_output?.phrases ?? [];
  const spans: Underline[] = [];
  let searchFrom = 0;

  for (const phrase of phrases) {
    // Only look at the not-yet-consumed tail, so repeated phrases advance
    // instead of all matching the same first occurrence.
    const remainder = card.body.slice(searchFrom);
    const match = findVerbatim(remainder, phrase);
    if (!match) continue;

    const start = searchFrom + match.start;
    const end = searchFrom + match.end;
    spans.push({ start, end });
    searchFrom = end;
  }

  return spans;
}

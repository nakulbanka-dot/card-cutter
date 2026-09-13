import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, cuttingModel } from "../clients";
import { reasoningFor, effortConfig } from "../reasoning";
import { findVerbatim } from "../verbatim";
import type { Card, Source } from "../types";
import type { Expansion } from "./expand";

/**
 * Stage 4 — cut.
 *
 * Claude reads one article and proposes cards. Whatever it returns as the
 * quote is treated as a *pointer*, not as content: we look the quote up in
 * the real article and put the article's own characters on the card. A quote
 * that can't be found is a rewritten quote, and the card is discarded.
 */

const CandidateSchema = z.object({
  tag: z.string(),
  quote: z.string(),
  author: z.string(),
  qualification: z.string().nullable(),
  publication: z.string(),
  date: z.string().nullable(),
  rationale: z.string(),
});

const CutSchema = z.object({
  /** Empty when the article has nothing worth reading in a round. */
  cards: z.array(CandidateSchema).max(3),
  /** If cards is empty, why. */
  skipReason: z.string().nullable(),
});

const SYSTEM = `You cut evidence cards for competitive debate.

You get one article and a claim. Return at most 3 cards — usually 0 or 1.
Most articles contain nothing worth reading aloud. Returning nothing is the
correct and common answer; do not manufacture a card to seem useful.

THE QUOTE FIELD IS THE ONE THAT MATTERS.

Copy it character-for-character out of the article. Do not tighten it, fix
its grammar, modernize its punctuation, splice two passages together, or
drop a hedge like "may" or "could". The text you return is checked against
the article automatically and the card is thrown out if it does not match.
A card whose quote you improved is worse than no card at all.

Quote a continuous passage, typically 1-4 sentences. It must be long enough
that its meaning survives without the surrounding paragraph.

What makes a card worth cutting:
- It states a conclusion, not background or setup.
- The author has standing to make that claim.
- It has a warrant — it says WHY, not only THAT.
- Read aloud, it would move a judge.

Do not cut: the article's own summary of someone else's work, a quote of a
third party (cut the third party's own writing instead), pure description,
or anything hedged into meaninglessness.

Other fields:
- tag: one sentence, the claim the card proves. Written to be read aloud.
- author / qualification: the person who wrote it and why they're credible.
  Use null for qualification if the article doesn't say. Do not guess it.
- date: ISO-8601 if determinable, else null.
- rationale: one line on why this supports the claim. For review, not the doc.`;

export interface CutOutcome {
  cards: Card[];
  rejected: { url: string; reason: string }[];
}

export async function cutFromSource(
  source: Source,
  expansion: Expansion,
): Promise<CutOutcome> {
  const direction =
    expansion.side === "refutes"
      ? "Find evidence that REFUTES this claim"
      : "Find evidence that SUPPORTS this claim";

  const model = cuttingModel();
  const reasoning = reasoningFor(model, "high", 8_000);

  const response = await anthropic().messages.parse({
    model,
    max_tokens: 8_000,
    system: SYSTEM,
    thinking: reasoning.thinking,
    output_config: { format: zodOutputFormat(CutSchema), ...effortConfig(reasoning) },
    messages: [
      {
        role: "user",
        content: [
          `${direction}:`,
          expansion.claim,
          "",
          `ARTICLE — ${source.title}`,
          `URL: ${source.url}`,
          "",
          source.body,
        ].join("\n"),
      },
    ],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    return {
      cards: [],
      rejected: [{ url: source.url, reason: "model returned unusable output" }],
    };
  }

  if (parsed.cards.length === 0) {
    return {
      cards: [],
      rejected: [
        { url: source.url, reason: parsed.skipReason ?? "nothing worth cutting" },
      ],
    };
  }

  const cards: Card[] = [];
  const rejected: CutOutcome["rejected"] = [];

  for (const candidate of parsed.cards) {
    const match = findVerbatim(source.body, candidate.quote);

    if (!match) {
      // The model rewrote the passage. This is the failure the whole design
      // exists to catch, so it is dropped rather than repaired.
      rejected.push({
        url: source.url,
        reason: "quote did not appear in the article verbatim — card discarded",
      });
      continue;
    }

    cards.push({
      tag: candidate.tag,
      // The article's characters, not the model's.
      body: match.text,
      underlines: [],
      rationale: candidate.rationale,
      cite: {
        author: candidate.author,
        qualification: candidate.qualification ?? undefined,
        publication: candidate.publication,
        date: candidate.date ?? undefined,
        url: source.url,
      },
    });
  }

  return { cards, rejected };
}

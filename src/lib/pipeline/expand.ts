import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, cuttingModel } from "../clients";

/**
 * Stage 1 — expand.
 *
 * "AI regulation kills innovation" is a debate claim, not a search query.
 * Turn it into queries that will actually surface evidence, and work out
 * which side of the claim the user wants supported.
 */

const ExpansionSchema = z.object({
  /** Which side the cards should support. */
  side: z.enum(["supports", "refutes", "both"]),
  /** The claim restated as a full sentence, for the cutter's benefit. */
  claim: z.string(),
  /** Search queries — specific, sourceable, no debate jargon. */
  queries: z.array(z.string()).min(1).max(8),
});

export type Expansion = z.infer<typeof ExpansionSchema>;

const SYSTEM = `You turn a debater's shorthand into web search queries.

The input is 5-10 words stating a position. Your job:

1. Restate it as one full declarative sentence (the claim).
2. Decide whether they want evidence that SUPPORTS the claim (the default),
   REFUTES it (if they said "answers to", "AT", "against"), or BOTH.
3. Write 3-6 search queries likely to surface quotable expert evidence.

Query rules:
- Name the concrete thing: statutes, agencies, programs, countries, years.
  "EU AI Act compliance cost startups" beats "AI regulation bad".
- Vary the angle across queries: empirical studies, expert commentary,
  industry data, named cases. Do not write six rewordings of one query.
- No debate jargon. No boolean operators. Plain search phrasing.
- Prefer sources with credentialed authors; think reports, journals, and
  serious press rather than blogs.`;

export async function expand(query: string): Promise<Expansion> {
  const response = await anthropic().messages.parse({
    model: cuttingModel(),
    max_tokens: 2_000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      format: zodOutputFormat(ExpansionSchema),
      effort: "low",
    },
    messages: [{ role: "user", content: query }],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(`Could not expand the query: ${query}`);
  }
  return parsed;
}

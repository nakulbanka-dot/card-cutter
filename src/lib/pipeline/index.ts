import { DEFAULT_SOURCE_LIMIT } from "../models";
import { mapWithConcurrency } from "../concurrency";
import type { CutResponse } from "../types";
import { expand } from "./expand";
import { search } from "./search";
import { extract } from "./extract";
import { cutFromSource } from "./cut";
import { underline } from "./underline";

export { expand, search, extract, cutFromSource, underline };

/** Articles read concurrently. Each one is a full-length Opus call. */
const CUT_CONCURRENCY = 3;

/**
 * query -> expand -> search -> extract -> cut -> underline -> cards
 */
export async function cutCards(
  query: string,
  limit: number = DEFAULT_SOURCE_LIMIT,
): Promise<CutResponse> {
  const expansion = await expand(query);

  const hits = await search(expansion, limit);
  if (hits.length === 0) {
    return { query, cards: [], rejected: [] };
  }

  const { sources, failed } = await extract(hits);

  const outcomes = await mapWithConcurrency(
    sources,
    CUT_CONCURRENCY,
    (source) => cutFromSource(source, expansion),
  );

  const cards = outcomes.flatMap((o) => o.cards);
  const rejected = [...failed, ...outcomes.flatMap((o) => o.rejected)];

  // Underline only what survived the verbatim check.
  const underlined = await mapWithConcurrency(cards, CUT_CONCURRENCY, async (card) => ({
    ...card,
    underlines: await underline(card),
  }));

  return { query, cards: underlined, rejected };
}

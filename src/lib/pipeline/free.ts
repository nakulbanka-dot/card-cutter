import { defaultSourceLimit } from "../env";
import { tavilyClientInstance } from "../clients";
import { mapWithConcurrency } from "../concurrency";
import { parseQuery, searchVariants } from "../terms";
import { rankPassages, type Passage } from "../passages";
import { extract } from "./extract";
import type { Hit } from "./search";

/**
 * Free mode — no model calls, no Anthropic key.
 *
 * Search, pull the full text, and point at the paragraphs most likely to hold
 * the card. You do the cutting. This is the whole pipeline minus the expensive
 * stage, and the stage it drops is the one you're good at anyway.
 */

export interface FoundSource {
  url: string;
  title: string;
  publishedAt?: string;
  /** Highest-scoring paragraphs, best first. */
  passages: Passage[];
  /** Full extracted text, kept so the UI can offer the whole article. */
  body: string;
}

export interface FindResponse {
  query: string;
  terms: string[];
  wantsRefutation: boolean;
  sources: FoundSource[];
  skipped: { url: string; reason: string }[];
}

const MAX_PER_DOMAIN = 2;
const PASSAGES_PER_SOURCE = 4;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function findEvidence(
  query: string,
  limit: number = defaultSourceLimit(),
): Promise<FindResponse> {
  const parsed = parseQuery(query);
  const client = tavilyClientInstance();

  const perVariant = await mapWithConcurrency(
    searchVariants(parsed),
    3,
    async (q): Promise<Hit[]> => {
      try {
        const res = await client.search(q, {
          searchDepth: "advanced",
          maxResults: Math.max(5, limit),
          topic: "general",
        });
        return res.results.map((r) => ({
          url: r.url,
          title: r.title,
          score: r.score,
          publishedDate: r.publishedDate,
          viaQuery: q,
        }));
      } catch {
        return [];
      }
    },
  );

  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  const hits: Hit[] = [];

  for (const hit of perVariant.flat().sort((a, b) => b.score - a.score)) {
    if (seen.has(hit.url)) continue;
    const domain = domainOf(hit.url);
    const used = perDomain.get(domain) ?? 0;
    if (used >= MAX_PER_DOMAIN) continue;

    seen.add(hit.url);
    perDomain.set(domain, used + 1);
    hits.push(hit);
    if (hits.length >= limit) break;
  }

  if (hits.length === 0) {
    return {
      query,
      terms: parsed.terms,
      wantsRefutation: parsed.wantsRefutation,
      sources: [],
      skipped: [],
    };
  }

  const { sources, failed } = await extract(hits);
  const skipped = [...failed];

  const found: FoundSource[] = [];
  for (const source of sources) {
    const passages = rankPassages(source.body, parsed.terms, PASSAGES_PER_SOURCE);

    if (passages.length === 0) {
      skipped.push({
        url: source.url,
        reason: "extracted fine, but no paragraph mentioned your terms",
      });
      continue;
    }

    found.push({
      url: source.url,
      title: source.title,
      publishedAt: source.publishedAt,
      passages,
      body: source.body,
    });
  }

  // Sources whose best paragraph scored highest go first.
  found.sort((a, b) => b.passages[0].score - a.passages[0].score);

  return {
    query,
    terms: parsed.terms,
    wantsRefutation: parsed.wantsRefutation,
    sources: found,
    skipped,
  };
}

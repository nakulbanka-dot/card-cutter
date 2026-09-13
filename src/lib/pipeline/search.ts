import { tavilyClientInstance } from "../clients";
import { mapWithConcurrency } from "../concurrency";
import type { Expansion } from "./expand";

/**
 * Stage 2 — search.
 *
 * One Tavily call per expanded query, then merge. Deduped by URL and capped
 * per domain, because eight cards off the same outlet is one card as far as
 * a judge is concerned.
 */

export interface Hit {
  url: string;
  title: string;
  score: number;
  publishedDate?: string;
  /** Which expanded query surfaced this. Useful for debugging relevance. */
  viaQuery: string;
}

const MAX_PER_DOMAIN = 2;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function search(
  expansion: Expansion,
  limit: number,
): Promise<Hit[]> {
  const client = tavilyClientInstance();

  const perQuery = await mapWithConcurrency(
    expansion.queries,
    4,
    async (q): Promise<Hit[]> => {
      try {
        const res = await client.search(q, {
          searchDepth: "advanced",
          maxResults: Math.max(5, Math.ceil(limit / 2)),
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
        // One dead query shouldn't sink the whole search.
        return [];
      }
    },
  );

  const seenUrls = new Set<string>();
  const perDomain = new Map<string, number>();
  const merged: Hit[] = [];

  // Best-scoring first, so the per-domain cap keeps the strongest hits.
  for (const hit of perQuery.flat().sort((a, b) => b.score - a.score)) {
    if (seenUrls.has(hit.url)) continue;

    const domain = domainOf(hit.url);
    const used = perDomain.get(domain) ?? 0;
    if (used >= MAX_PER_DOMAIN) continue;

    seenUrls.add(hit.url);
    perDomain.set(domain, used + 1);
    merged.push(hit);

    if (merged.length >= limit) break;
  }

  return merged;
}

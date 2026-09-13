import { tavilyClientInstance } from "../clients";
import type { Source } from "../types";
import type { Hit } from "./search";

/**
 * Stage 3 — extract.
 *
 * Search snippets are useless for cutting; the quotable paragraph is almost
 * never the one the search engine previewed. Pull the full text.
 */

export interface ExtractOutcome {
  sources: Source[];
  failed: { url: string; reason: string }[];
}

/** Below this, extraction almost certainly hit a paywall or a consent wall. */
const MIN_USABLE_CHARS = 600;

export async function extract(hits: Hit[]): Promise<ExtractOutcome> {
  if (hits.length === 0) return { sources: [], failed: [] };

  const client = tavilyClientInstance();
  const byUrl = new Map(hits.map((h) => [h.url, h]));

  const res = await client.extract(
    hits.map((h) => h.url),
    { extractDepth: "advanced", format: "markdown" },
  );

  const sources: Source[] = [];
  const failed: { url: string; reason: string }[] = res.failedResults.map(
    (f) => ({ url: f.url, reason: f.error || "extraction failed" }),
  );

  for (const r of res.results) {
    const hit = byUrl.get(r.url);
    const body = r.rawContent ?? "";

    if (body.trim().length < MIN_USABLE_CHARS) {
      failed.push({
        url: r.url,
        reason: "too little text recovered — likely paywalled",
      });
      continue;
    }

    sources.push({
      url: r.url,
      title: r.title ?? hit?.title ?? r.url,
      body,
      publishedAt: hit?.publishedDate,
    });
  }

  return { sources, failed };
}

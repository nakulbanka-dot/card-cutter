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

/**
 * Bot walls return a full page of text, so the length check waves them
 * through and they rank on keyword overlap like any other source. One turned
 * up in results titled "Checking your browser - reCAPTCHA".
 */
const BOT_WALL =
  /(checking your browser|recaptcha|cloudflare|are you a robot|enable javascript to continue|access denied|verify you are human|ddos protection|attention required)/i;

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

    const title = r.title ?? hit?.title ?? "";
    // Check the title and the opening, which is where the wall announces
    // itself; the article body may legitimately discuss any of these words.
    if (BOT_WALL.test(title) || BOT_WALL.test(body.slice(0, 400))) {
      failed.push({ url: r.url, reason: "the site blocked automated access" });
      continue;
    }

    sources.push({
      url: r.url,
      title: title || r.url,
      body,
      publishedAt: hit?.publishedDate,
    });
  }

  return { sources, failed };
}

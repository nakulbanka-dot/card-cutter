import { tavilyClientInstance } from "../clients";
import { mapWithConcurrency } from "../concurrency";
import { fetchPage } from "../fetch-page";
import type { ArticleMetadata } from "../citation";
import type { Source } from "../types";
import type { Hit } from "./search";

/**
 * Stage 3 — get the full text.
 *
 * Fetched ourselves first, over plain HTTP, which costs nothing. Only the
 * pages that come back empty — JavaScript-rendered articles, bot walls,
 * paywalls — go to the paid extractor.
 *
 * This used to extract every article through the paid service and then fetch
 * each page again separately for its citation metadata: two requests per
 * article, one of them billed. Now one free request usually does both jobs,
 * and the bill is only for what we genuinely cannot read.
 */

export interface ExtractedSource extends Source {
  /** Read from the page's own markup during the same fetch, when we did one. */
  metadata?: ArticleMetadata;
}

export interface ExtractOutcome {
  sources: ExtractedSource[];
  failed: { url: string; reason: string }[];
  /** How many needed the paid extractor. Worth watching; it is the bill. */
  paidExtractions: number;
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

function isWall(title: string, body: string): boolean {
  // Title and opening only; an article may legitimately discuss these words.
  return BOT_WALL.test(title) || BOT_WALL.test(body.slice(0, 400));
}

export async function extract(hits: Hit[]): Promise<ExtractOutcome> {
  if (hits.length === 0) return { sources: [], failed: [], paidExtractions: 0 };

  const byUrl = new Map(hits.map((h) => [h.url, h]));
  const sources: ExtractedSource[] = [];
  const failed: { url: string; reason: string }[] = [];

  // --- free pass ---
  const pages = await mapWithConcurrency(hits, 6, (h) => fetchPage(h.url));
  const needsPaid: Hit[] = [];

  for (const page of pages) {
    const hit = byUrl.get(page.url)!;
    if (!page.usable) {
      needsPaid.push(hit);
      continue;
    }

    const title = page.metadata.title ?? hit.title;
    if (isWall(title, page.body)) {
      failed.push({ url: page.url, reason: "the site blocked automated access" });
      continue;
    }

    sources.push({
      url: page.url,
      title: title || page.url,
      body: page.body,
      publishedAt: page.metadata.published ?? hit.publishedDate,
      metadata: page.metadata,
    });
  }

  // --- paid fallback, only for what we could not read ---
  let paidExtractions = 0;
  if (needsPaid.length > 0) {
    paidExtractions = needsPaid.length;
    try {
      const res = await tavilyClientInstance().extract(
        needsPaid.map((h) => h.url),
        { extractDepth: "advanced", format: "markdown" },
      );

      for (const f of res.failedResults) {
        failed.push({ url: f.url, reason: f.error || "extraction failed" });
      }

      for (const r of res.results) {
        const hit = byUrl.get(r.url);
        const body = r.rawContent ?? "";
        const title = r.title ?? hit?.title ?? r.url;

        if (body.trim().length < MIN_USABLE_CHARS) {
          failed.push({
            url: r.url,
            reason: "too little text recovered — likely paywalled",
          });
          continue;
        }
        if (isWall(title, body)) {
          failed.push({ url: r.url, reason: "the site blocked automated access" });
          continue;
        }

        sources.push({
          url: r.url,
          title,
          body,
          publishedAt: hit?.publishedDate,
        });
      }
    } catch {
      for (const h of needsPaid) {
        failed.push({ url: h.url, reason: "could not read this page" });
      }
    }
  }

  return { sources, failed, paidExtractions };
}

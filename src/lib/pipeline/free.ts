import { TavilyKeylessLimitError } from "@tavily/core";
import { defaultSourceLimit, hasTavilyKey } from "../env";
import { tavilyClientInstance } from "../clients";
import { mapWithConcurrency } from "../concurrency";
import { parseQuery, searchVariants } from "../terms";
import { rankPassages, type Passage } from "../passages";
import { matchScore, type MatchBreakdown } from "../match-score";
import { scoreStanceBatch } from "../ranking/stance";
import { fetchMetadata } from "../metadata";
import { toMLA, type ArticleMetadata } from "../citation";
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
  /** Ready-to-paste MLA 9 works-cited entry. */
  mla: string;
  /** Fields we couldn't determine from the page — the user fills these in. */
  missingCiteFields: string[];
  metadata: ArticleMetadata;
  /** Absolute topical fit, with the components that produced it. */
  match: MatchBreakdown;
}

export interface FindResponse {
  query: string;
  /** False when running on Tavily's keyless tier, which has tighter caps. */
  usingKey: boolean;
  terms: string[];
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
  /** URLs already shown — lets "show me different sources" skip them. */
  exclude: string[] = [],
): Promise<FindResponse> {
  const parsed = parseQuery(query);
  const client = tavilyClientInstance();

  const perVariant = await mapWithConcurrency(
    searchVariants(parsed),
    3,
    async (q): Promise<Hit[]> => {
      try {
        const res = await client.search(q, {
          // Basic costs half what advanced does, and we rank paragraphs
          // ourselves anyway — advanced mainly improves Tavily's own snippet
          // relevance, which free mode throws away.
          searchDepth: "basic",
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
      } catch (err) {
        // A keyless cap is the user's whole answer, not a dead query — let it
        // through so they see why nothing came back.
        if (err instanceof TavilyKeylessLimitError) throw err;
        return [];
      }
    },
  );

  // Seed with what the caller has already seen so a refresh returns new
  // material rather than re-ranking the same eight articles.
  const seen = new Set<string>(exclude);
  const excludedDomains = new Set(exclude.map(domainOf));
  const perDomain = new Map<string, number>();
  const hits: Hit[] = [];

  for (const hit of perVariant.flat().sort((a, b) => b.score - a.score)) {
    if (seen.has(hit.url)) continue;
    const domain = domainOf(hit.url);
    // On a refresh, prefer outlets the user has not seen at all.
    if (excludedDomains.has(domain)) continue;
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
      usingKey: hasTavilyKey(),
      terms: parsed.terms,
      sources: [],
      skipped: [],
    };
  }

  const { sources, failed } = await extract(hits);
  const skipped = [...failed];

  const keep = sources.filter((source) => {
    const passages = rankPassages(source.body, parsed.terms, PASSAGES_PER_SOURCE);
    if (passages.length === 0) {
      skipped.push({
        url: source.url,
        reason: "extracted fine, but no paragraph mentioned your terms",
      });
      return false;
    }
    return true;
  });

  // Citation metadata comes from each page's own markup, so this is a plain
  // fetch per source — free, and parallel since they're independent.
  const found: FoundSource[] = await mapWithConcurrency(keep, 5, async (source) => {
    const metadata = await fetchMetadata(source.url);

    // Tavily's title and date are decent fallbacks when the page omits them.
    if (!metadata.title && source.title) {
      metadata.title = source.title;
      metadata.missing = metadata.missing.filter((f) => f !== "title");
    }
    if (!metadata.published && source.publishedAt) {
      metadata.published = source.publishedAt;
      metadata.missing = metadata.missing.filter((f) => f !== "date");
    }

    const passages = rankPassages(source.body, parsed.terms, PASSAGES_PER_SOURCE);
    const title = metadata.title ?? source.title;

    return {
      url: source.url,
      title,
      publishedAt: metadata.published ?? source.publishedAt,
      passages,
      body: source.body,
      mla: toMLA(metadata),
      missingCiteFields: metadata.missing,
      metadata,
      match: matchScore(parsed.terms, {
        title,
        passage: passages[0]?.text ?? "",
        article: source.body,
      }),
    };
  });

  // Stance: does each source argue the claim, or against it? This is what
  // keyword matching cannot see, and it runs on the best passage of each
  // source rather than every passage — about 200ms apiece.
  const stances = await scoreStanceBatch(
    parsed.searchQuery,
    found.map((f) => ({ title: f.title, text: f.passages[0]?.text ?? "" })),
  );

  found.forEach((f, i) => {
    const support = stances[i];
    if (support === null) return; // model unavailable — keep keyword-only score
    f.match = matchScore(
      parsed.terms,
      { title: f.title, passage: f.passages[0]?.text ?? "", article: f.body },
      support,
    );
  });

  // Sources whose best paragraph scored highest go first.
  found.sort((a, b) => b.match.score - a.match.score);

  return {
    query,
    usingKey: hasTavilyKey(),
    terms: parsed.terms,
    sources: found,
    skipped,
  };
}

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
  /** Searches this visitor has left today. Added by the route. */
  searchesLeftToday?: number;
  /** False when running on Tavily's keyless tier, which has tighter caps. */
  usingKey: boolean;
  terms: string[];
  sources: FoundSource[];
  skipped: { url: string; reason: string }[];
}

const MAX_PER_DOMAIN = 2;
const PASSAGES_PER_SOURCE = 4;
/**
 * Candidates the model reads before choosing.
 *
 * Keyword scoring is only a shortlist: it is cheap and it is bad at judgment,
 * so it narrows each article to a handful of plausible paragraphs and the
 * model decides which of those actually argue the claim. Reading every
 * paragraph of every article would be better and far too slow.
 *
 * Five rather than eight. Reading is ~200ms a paragraph and the gain from the
 * last few candidates was small — they were rarely chosen.
 */
const CANDIDATES_PER_SOURCE = 5;

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

    const candidates = rankPassages(source.body, parsed.terms, CANDIDATES_PER_SOURCE);
    const title = metadata.title ?? source.title;

    return {
      url: source.url,
      title,
      publishedAt: metadata.published ?? source.publishedAt,
      passages: candidates,
      body: source.body,
      mla: toMLA(metadata),
      missingCiteFields: metadata.missing,
      metadata,
      match: matchScore(parsed.terms, {
        title,
        passage: candidates[0]?.text ?? "",
        article: source.body,
      }),
    };
  });

  // The model reads every shortlisted paragraph, not just the first one.
  // Keyword scoring got them onto the shortlist; this decides which of them
  // is actually worth cutting, and in what order.
  const jobs: { source: number; passage: number; title: string; text: string }[] = [];
  found.forEach((f, si) => {
    f.passages.forEach((p, pi) => {
      jobs.push({ source: si, passage: pi, title: f.title, text: p.text });
    });
  });

  const read = await scoreStanceBatch(
    parsed.searchQuery,
    jobs.map((j) => ({ title: j.title, text: j.text })),
  );

  const supportBySource = new Map<number, number[]>();
  jobs.forEach((job, i) => {
    const support = read[i];
    if (support === null) return;
    found[job.source].passages[job.passage].support = support;
    const list = supportBySource.get(job.source) ?? [];
    list.push(support);
    supportBySource.set(job.source, list);
  });

  found.forEach((f, si) => {
    const supports = supportBySource.get(si);

    // Order paragraphs by what the model found, keeping keyword score only as
    // a tiebreaker for anything it could not read.
    f.passages.sort((a, b) => (b.support ?? -1) - (a.support ?? -1) || b.score - a.score);
    f.passages = f.passages.slice(0, PASSAGES_PER_SOURCE);

    if (!supports || supports.length === 0) return;
    // A source is as good as its best paragraph, which is what you would cut.
    const best = Math.max(...supports);
    f.match = matchScore(
      parsed.terms,
      { title: f.title, passage: f.passages[0]?.text ?? "", article: f.body },
      best,
    );
  });

  found.sort((a, b) => b.match.score - a.match.score);

  return {
    query,
    usingKey: hasTavilyKey(),
    terms: parsed.terms,
    sources: found,
    skipped,
  };
}

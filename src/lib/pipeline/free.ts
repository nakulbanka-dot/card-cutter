import { TavilyKeylessLimitError } from "@tavily/core";
import { defaultSourceLimit, hasTavilyKey } from "../env";
import { tavilyClientInstance } from "../clients";
import { mapWithConcurrency } from "../concurrency";
import { parseQuery, searchVariants } from "../terms";
import { rankPassages, candidateParagraphs, type Passage } from "../passages";
import { matchScore, type MatchBreakdown } from "../match-score";
import { rankByMeaning } from "../ranking/retriever";
import { scoreCuttable } from "../ranking/reranker";
import { fetchMetadata } from "../metadata";
import { toMLA, type ArticleMetadata } from "../citation";
import { extract } from "./extract";
import { looksLikeBotWall } from "./bot-wall.ts";
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
  /** Whether the model read this source, or it fell outside the read budget. */
  wasRead?: boolean;
}

export interface FindResponse {
  query: string;
  /** Searches this visitor has left today. Added by the route. */
  searchesLeftToday?: number;
  /** False when running on Tavily's keyless tier, which has tighter caps. */
  usingKey: boolean;
  /**
   * How many articles needed the paid extractor. The rest were read over
   * plain HTTP for nothing, which is most of them.
   */
  paidExtractions?: number;
  terms: string[];
  sources: FoundSource[];
  skipped: { url: string; reason: string }[];
}

const MAX_PER_DOMAIN = 2;
const PASSAGES_PER_SOURCE = 4;
/**
 * Candidates the reranker judges per source.
 *
 * The retriever nominates them by meaning; the reranker decides which are
 * worth cutting. Both run on this machine, so the old distinction between a
 * local and a hosted budget is gone — and with it the cap that showed a
 * deployed search eight passages where a local one showed twenty-four.
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

  // Collected so a failing search can be told apart from a search that
  // genuinely matched nothing. A dead API key was reporting "no results",
  // which sends you looking for a better query instead of a working key.
  const searchErrors: unknown[] = [];

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
        searchErrors.push(err);
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

  if (hits.length === 0 && searchErrors.length > 0) {
    const first = searchErrors[0];
    const message = first instanceof Error ? first.message : String(first);
    // Surfaced rather than swallowed: every search call failed, which is a
    // different problem from finding nothing.
    throw new Error(
      /401|unauthor/i.test(message)
        ? "Search is not authorised — the API key is missing or no longer valid."
        : "Search is unavailable right now. Try again shortly.",
    );
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

  const { sources, failed, paidExtractions } = await extract(hits);
  const skipped = [...failed];

  // Keep any source with readable prose in it.
  //
  // This used to drop a source when no paragraph mentioned the tag's words,
  // which quietly undid the point of semantic retrieval: an article arguing
  // your claim in the author's own vocabulary was discarded before the
  // retriever ever saw it. The keyword test belonged to a pipeline that could
  // only match words.
  const keep = sources.filter((source) => {
    if (candidateParagraphs(source.body).length === 0) {
      skipped.push({
        url: source.url,
        reason: "extracted fine, but nothing on the page reads as prose",
      });
      return false;
    }
    return true;
  });

  // Citation metadata comes from each page's own markup, so this is a plain
  // fetch per source — free, and parallel since they're independent.
  const found: FoundSource[] = await mapWithConcurrency(keep, 5, async (source) => {
    // Extraction already read this page's markup in most cases, so the
    // metadata came free with it. Only the ones that needed the paid
    // extractor still have to be fetched for their citation.
    const metadata = source.metadata ?? (await fetchMetadata(source.url));

    // A bot wall answered the metadata request. The article itself was read
    // fine — the paid extractor got through where this second request did
    // not — so only the title is wrong, and leaving it would put "Checking
    // your browser - reCAPTCHA" in the citation.
    if (metadata.title && looksLikeBotWall(metadata.title)) {
      metadata.title = undefined;
      if (!metadata.missing.includes("title")) metadata.missing.push("title");
    }

    // Tavily's title and date are decent fallbacks when the page omits them.
    if (!metadata.title && source.title) {
      metadata.title = source.title;
      metadata.missing = metadata.missing.filter((f) => f !== "title");
    }
    if (!metadata.published && source.publishedAt) {
      metadata.published = source.publishedAt;
      metadata.missing = metadata.missing.filter((f) => f !== "date");
    }

    // Shortlist by meaning where the retriever is available.
    //
    // Keyword scoring could only nominate paragraphs that reuse the tag's
    // words, so a paragraph making the argument in the author's own
    // vocabulary was never a candidate and the reranker never saw it.
    // Measured over the whole test split, the retriever finds the cut
    // paragraph in its top twenty 77% of the time against keyword's 56%.
    //
    // Falls back to keyword scoring when the model is not present, which is
    // worse but honest — and reported, so a silent downgrade cannot be
    // mistaken for the real thing.
    const all = candidateParagraphs(source.body);
    let semantic: Map<string, number> | undefined;
    if (all.length > 0) {
      const scores = await rankByMeaning(parsed.claim, all.map((p) => p.text));
      if (scores) {
        semantic = new Map(all.map((p, i) => [p.text, scores[i]]));
      }
    }

    const candidates = rankPassages(
      source.body,
      parsed.terms,
      CANDIDATES_PER_SOURCE,
      semantic,
    );
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
  // Best keyword matches first, so the budget goes to the contenders.
  found.sort((a, b) => b.match.score - a.match.score);

  // Breadth before depth.
  //
  // Spending the budget depth-first meant the top few sources had every
  // candidate read while the rest had none — so most passages on screen were
  // picks the model never saw. Reading one passage from every source first
  // means nothing is shown unjudged; leftover budget then goes on second and
  // third candidates from the strongest sources.
  const jobs: { source: number; passage: number; title: string; text: string }[] = [];

  // No budget any more. The reranker runs on this machine — there is no
  // per-call network round trip to ration, which is what the budget existed
  // for. It capped production at ten reads and was why a deployed search
  // showed eight passages where a local one showed twenty-four.
  const budget = Infinity;

  const deepest = Math.max(0, ...found.map((f) => f.passages.length));
  outer: for (let depth = 0; depth < deepest; depth++) {
    for (let si = 0; si < found.length; si++) {
      if (jobs.length >= budget) break outer;
      const passage = found[si].passages[depth];
      if (!passage) continue;
      jobs.push({ source: si, passage: depth, title: found[si].title, text: passage.text });
    }
  }

  // The claim as written, not the search query. The reranker was trained on
  // real tags, and "solves" against "prevents" is the whole card.
  const read = await scoreCuttable(
    parsed.claim,
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
    f.wasRead = supports !== undefined && supports.length > 0;

    // Order paragraphs by what the model found, keeping keyword score only as
    // a tiebreaker for anything it could not read.
    f.passages.sort((a, b) => (b.support ?? -1) - (a.support ?? -1) || b.score - a.score);

    // If any passage from this source was read, show only read ones. Mixing a
    // judged passage with an unjudged one below it invites the reader to treat
    // both as vetted, when the second is whatever the keywords happened to
    // match. Better to show two good passages than four of unknown standing.
    const judged = f.passages.filter((p) => p.support !== undefined);
    f.passages = (judged.length > 0 ? judged : f.passages).slice(0, PASSAGES_PER_SOURCE);

    if (!supports || supports.length === 0) return;
    // A source is as good as its best paragraph, which is what you would cut.
    const best = Math.max(...supports);
    f.match = matchScore(
      parsed.terms,
      { title: f.title, passage: f.passages[0]?.text ?? "", article: f.body },
      best,
    );
  });

  // Sort on the score alone. Promoting read sources above unread ones was
  // wrong: a source the model read and scored at 21% support is known not to
  // argue your side, and an unread source is merely unjudged. Known-bad must
  // not outrank unknown. The score already carries the difference, since a
  // read source folds its support in at the heaviest weight.
  found.sort((a, b) => b.match.score - a.match.score);

  return {
    query,
    usingKey: hasTavilyKey(),
    paidExtractions,
    terms: parsed.terms,
    sources: found,
    skipped,
  };
}

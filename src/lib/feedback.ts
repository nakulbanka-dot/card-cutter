import { z } from "zod";
import { appendFeedback, readAllFeedback, activeBackend } from "./feedback-store.ts";

/**
 * The training set.
 *
 * Every passage the app shows gets logged with the features that made it rank,
 * plus what you did about it. That pairing — features in, your decision out —
 * is exactly what a supervised reranker needs, and it accumulates from normal
 * use rather than from a separate labeling chore.
 *
 * JSONL on local disk: append-only, greppable, trivially loadable by any
 * training script, and it never leaves your machine.
 *
 * A deployed copy has no writable disk, and serverless filesystems are wiped
 * between invocations anyway. There the log is disabled outright rather than
 * written somewhere that silently disappears — a training set you believe you
 * are collecting and are not is worse than none. Set CARD_CUTTER_COLLECT=1 on
 * a host with real storage to turn it back on.
 */

export type Action = "cut" | "reject" | "shown";

/**
 * Features are snapshotted at display time rather than recomputed at training
 * time. If the ranker changes later, old rows still describe the world that
 * produced that decision, which keeps the history honest.
 */
export interface PassageFeatures {
  /** Fraction of query terms present in the passage. */
  termCoverage: number;
  /** Total term occurrences. */
  termHits: number;
  /** Rank the passage was shown at (0-based). Position bias matters. */
  shownRank: number;
  /** Rank of its source among sources. */
  sourceRank: number;
  charCount: number;
  hasQuantity: boolean;
  hasQuote: boolean;
  /** Heuristic score that produced the ordering. */
  heuristicScore: number;
  domain: string;
  /** Whether the page declared an author — a proxy for citability. */
  hasAuthor: boolean;
}

export interface FeedbackRow {
  ts: string;
  query: string;
  terms: string[];
  url: string;
  passageText: string;
  action: Action;
  features: PassageFeatures;
}

/**
 * What a label may contain, and how much of it.
 *
 * The route used to store any JSON with a url and an action, whole. Two
 * problems with that. A script could send 200 rows an hour of any size and
 * fill a RAM-only Redis plan, after which real testers' labels stop saving.
 * And a single row without `features` broke the public stats for good,
 * because computeStats reads every row's features.
 *
 * The caps are far above anything the app sends — a passage is at most a few
 * paragraphs — so they only ever refuse something that was not a label.
 * Unknown keys are dropped rather than stored.
 */
const num = z.number().nullable();
const FeedbackInput = z.object({
  query: z.string().max(1_000),
  terms: z.array(z.string().max(100)).max(100),
  url: z.string().min(1).max(2_048),
  passageText: z.string().max(20_000),
  action: z.enum(["cut", "reject", "shown"]),
  features: z.object({
    termCoverage: num,
    termHits: num,
    shownRank: num,
    sourceRank: num,
    charCount: num,
    hasQuantity: z.boolean(),
    hasQuote: z.boolean(),
    heuristicScore: num,
    domain: z.string().max(255),
    hasAuthor: z.boolean(),
  }),
});

/** A label as the client sent it, checked; null if it is not one. */
export function parseFeedback(input: unknown): Omit<FeedbackRow, "ts"> | null {
  const parsed = FeedbackInput.safeParse(input);
  return parsed.success ? (parsed.data as Omit<FeedbackRow, "ts">) : null;
}

/** True when rows are actually being stored somewhere durable. */
export function collectionEnabled(): boolean {
  return activeBackend() !== "none";
}

export async function logFeedback(row: FeedbackRow): Promise<boolean> {
  const stored = await appendFeedback(row);
  // So the stats this instance serves include the label just recorded.
  if (stored) clearStatsCache();
  return stored;
}

/** Read the whole log. Small enough to hold in memory for a long time. */
export async function readFeedback(): Promise<FeedbackRow[]> {
  return readAllFeedback();
}

export { activeBackend };

export interface Stats {
  total: number;
  cut: number;
  rejected: number;
  shown: number;
  /** Of passages you acted on, the share you cut. The headline metric. */
  precision: number;
  /** Cut-rate by rank position — shows whether ranking is actually working. */
  byRank: { rank: number; shown: number; cut: number; rate: number }[];
  /** Domains ranked by how often their passages get cut. */
  domains: { domain: string; shown: number; cut: number; rate: number }[];
}

/**
 * How long one instance reuses the stats it computed.
 *
 * GET /api/feedback is public and reads the whole log on every request — the
 * entire Redis list, parsed row by row. Nothing in the app calls it; it is
 * there for checking on collection by hand, which never needs a figure
 * fresher than a minute. Without this, anyone refreshing it in a loop makes
 * every request a full read of the training set.
 */
const STATS_TTL_MS = 60_000;

let statsCache: { at: number; value: Promise<Stats> } | null = null;

/**
 * The stats, computed at most once a minute per instance.
 *
 * The promise is cached rather than the result, so a burst of requests that
 * arrives before the first read finishes shares that one read.
 */
export function readStats(
  now: number = Date.now(),
  read: () => Promise<FeedbackRow[]> = readFeedback,
): Promise<Stats> {
  if (statsCache && now - statsCache.at < STATS_TTL_MS) return statsCache.value;
  const value = read().then(computeStats);
  statsCache = { at: now, value };
  // A failed read must not be served for the next minute.
  value.catch(() => {
    if (statsCache?.value === value) statsCache = null;
  });
  return value;
}

/** Drop the cached stats. Also the test seam. */
export function clearStatsCache(): void {
  statsCache = null;
}

export function computeStats(rows: FeedbackRow[]): Stats {
  const cut = rows.filter((r) => r.action === "cut").length;
  const rejected = rows.filter((r) => r.action === "reject").length;
  const decided = cut + rejected;

  const rankBuckets = new Map<number, { shown: number; cut: number }>();
  const domainBuckets = new Map<string, { shown: number; cut: number }>();

  for (const row of rows) {
    // Rows stored before labels were validated may have no features. One of
    // those must not take the stats down for everyone.
    if (!row?.features) continue;
    const rank = row.features.shownRank;
    const rb = rankBuckets.get(rank) ?? { shown: 0, cut: 0 };
    rb.shown++;
    if (row.action === "cut") rb.cut++;
    rankBuckets.set(rank, rb);

    const db = domainBuckets.get(row.features.domain) ?? { shown: 0, cut: 0 };
    db.shown++;
    if (row.action === "cut") db.cut++;
    domainBuckets.set(row.features.domain, db);
  }

  return {
    total: rows.length,
    cut,
    rejected,
    shown: rows.filter((r) => r.action === "shown").length,
    precision: decided > 0 ? cut / decided : 0,
    byRank: [...rankBuckets.entries()]
      .map(([rank, b]) => ({ rank, ...b, rate: b.shown ? b.cut / b.shown : 0 }))
      .sort((a, b) => a.rank - b.rank),
    domains: [...domainBuckets.entries()]
      .map(([domain, b]) => ({ domain, ...b, rate: b.shown ? b.cut / b.shown : 0 }))
      .sort((a, b) => b.cut - a.cut),
  };
}

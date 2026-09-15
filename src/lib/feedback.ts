import { appendFeedback, readAllFeedback, activeBackend } from "./feedback-store";

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

/** True when rows are actually being stored somewhere durable. */
export function collectionEnabled(): boolean {
  return activeBackend() !== "none";
}

export async function logFeedback(row: FeedbackRow): Promise<boolean> {
  return appendFeedback(row);
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

export function computeStats(rows: FeedbackRow[]): Stats {
  const cut = rows.filter((r) => r.action === "cut").length;
  const rejected = rows.filter((r) => r.action === "reject").length;
  const decided = cut + rejected;

  const rankBuckets = new Map<number, { shown: number; cut: number }>();
  const domainBuckets = new Map<string, { shown: number; cut: number }>();

  for (const row of rows) {
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

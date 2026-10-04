import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFeedback, computeStats, readStats, clearStatsCache, type FeedbackRow,
} from "./feedback.ts";

/** What results.tsx sends when someone clicks Cut this. */
const label = {
  query: "nuclear power solves climate change",
  terms: ["nuclear", "power", "climate", "change"],
  url: "https://example.org/article",
  passageText: "France generates roughly 70 percent of its electricity from nuclear reactors.",
  action: "cut",
  features: {
    termCoverage: 0.5, termHits: 2, shownRank: 0, sourceRank: 1, charCount: 80,
    hasQuantity: true, hasQuote: false, heuristicScore: 0.71,
    domain: "example.org", hasAuthor: true,
  },
};

test("accepts the label the app sends", () => {
  assert.deepEqual(parseFeedback(label), label);
});

test("accepts a score that serialised to null", () => {
  // JSON.stringify turns NaN into null; that is still a real label.
  const row = { ...label, features: { ...label.features, heuristicScore: null } };
  assert.notEqual(parseFeedback(row), null);
});

test("drops keys that are not part of a label", () => {
  const row = parseFeedback({ ...label, extra: "x".repeat(10_000) });
  assert.ok(row);
  assert.equal("extra" in row, false);
});

test("refuses rows the stats could not read", () => {
  assert.equal(parseFeedback({ url: label.url, action: "cut" }), null);
  assert.equal(parseFeedback({ ...label, action: "maybe" }), null);
  assert.equal(parseFeedback(null), null);
  assert.equal(parseFeedback("cut"), null);
});

test("refuses oversized fields", () => {
  assert.equal(parseFeedback({ ...label, passageText: "a".repeat(20_001) }), null);
  assert.equal(parseFeedback({ ...label, terms: Array(101).fill("x") }), null);
});

test("stats skip a stored row with no features instead of throwing", () => {
  const rows = [
    { ...label, ts: "2026-10-01T00:00:00Z" },
    { url: label.url, action: "cut", ts: "2026-10-01T00:00:00Z" },
  ] as unknown as FeedbackRow[];
  const stats = computeStats(rows);
  assert.equal(stats.total, 2);
  assert.equal(stats.cut, 2);
  assert.equal(stats.byRank.length, 1);
});

/** A stand-in for the store that counts how often it was read. */
function counting(rows: FeedbackRow[]) {
  let reads = 0;
  return { read: async () => { reads++; return rows; }, reads: () => reads };
}

const ROW = { ...label, ts: "2026-10-01T00:00:00Z" } as FeedbackRow;

test("stats are read once a minute, not once a request", async () => {
  clearStatsCache();
  const store = counting([ROW]);
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) await readStats(t + i * 1_000, store.read);
  assert.equal(store.reads(), 1);
  assert.equal((await readStats(t + 61_000, store.read)).total, 1);
  assert.equal(store.reads(), 2);
});

test("requests that arrive together share one read", async () => {
  clearStatsCache();
  const store = counting([ROW]);
  await Promise.all([1, 2, 3].map(() => readStats(5_000_000, store.read)));
  assert.equal(store.reads(), 1);
});

test("a failed read is not served for the next minute", async () => {
  clearStatsCache();
  await assert.rejects(readStats(9_000_000, async () => { throw new Error("down"); }));
  const store = counting([ROW]);
  assert.equal((await readStats(9_001_000, store.read)).total, 1);
});

test("clearing the cache makes the next request read again", async () => {
  clearStatsCache();
  const store = counting([ROW]);
  await readStats(7_000_000, store.read);
  clearStatsCache();
  await readStats(7_001_000, store.read);
  assert.equal(store.reads(), 2);
});

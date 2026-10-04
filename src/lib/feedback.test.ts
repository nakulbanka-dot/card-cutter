import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedback, computeStats, type FeedbackRow } from "./feedback.ts";

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

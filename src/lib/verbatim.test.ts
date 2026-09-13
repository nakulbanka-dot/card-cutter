import test from "node:test";
import assert from "node:assert/strict";
import { findVerbatim, isVerbatim } from "./verbatim.ts";

const ARTICLE = `Regulatory compliance costs fall hardest on small firms.
As Chen notes, the EU AI Act "may substantially reduce" the number of
startups willing to enter the market — a chilling effect that larger
incumbents simply absorb.`;

test("accepts an exact quote", () => {
  const m = findVerbatim(ARTICLE, "Regulatory compliance costs fall hardest on small firms.");
  assert.ok(m);
  assert.equal(m.text, "Regulatory compliance costs fall hardest on small firms.");
});

test("tolerates line wrapping in the source", () => {
  // This span crosses a newline in ARTICLE; the model would quote it flat.
  const m = findVerbatim(ARTICLE, "the number of startups willing to enter the market");
  assert.ok(m);
  // Returns the ARTICLE's own characters, newline included.
  assert.match(m.text, /the number of\n *startups willing to enter the market/);
});

test("tolerates curly quotes, em dashes, and casing drift", () => {
  const m = findVerbatim(ARTICLE, 'the EU AI Act “may substantially reduce” the number');
  assert.ok(m);
  assert.ok(m.text.includes('"may substantially reduce"'));
});

test("REJECTS a reworded quote", () => {
  // "reduces" instead of "may substantially reduce" — the fabrication case.
  assert.equal(isVerbatim(ARTICLE, "the EU AI Act reduces the number of startups"), false);
});

test("REJECTS a dropped hedge", () => {
  assert.equal(isVerbatim(ARTICLE, "the EU AI Act may reduce the number of startups"), false);
});

test("REJECTS text that is simply not there", () => {
  assert.equal(isVerbatim(ARTICLE, "Chen argues regulation should be repealed."), false);
});

test("returns source offsets that slice back to the same text", () => {
  const m = findVerbatim(ARTICLE, "chilling effect");
  assert.ok(m);
  assert.equal(ARTICLE.slice(m.start, m.end), m.text);
});

test("empty or whitespace quotes are rejected", () => {
  assert.equal(isVerbatim(ARTICLE, ""), false);
  assert.equal(isVerbatim(ARTICLE, "   \n "), false);
});

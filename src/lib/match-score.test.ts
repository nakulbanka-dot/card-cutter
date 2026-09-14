import test from "node:test";
import assert from "node:assert/strict";
import { matchScore, asPercent } from "./match-score.ts";

const TERMS = ["nuclear", "climate", "france"];

test("a perfect match scores near 100", () => {
  const m = matchScore(TERMS, {
    title: "Nuclear power, climate policy, and France",
    passage: "France uses nuclear power to meet climate targets.",
    article: "France nuclear climate ".repeat(40),
  });
  assert.ok(asPercent(m.score) >= 95, `got ${asPercent(m.score)}`);
});

test("a source with none of the terms scores zero", () => {
  const m = matchScore(TERMS, {
    title: "Sourdough baking at altitude",
    passage: "Hydration ratios matter more than people think.",
    article: "Flour water salt ".repeat(50),
  });
  assert.equal(m.score, 0);
});

test("the score is absolute, not relative to other sources", () => {
  // A mediocre source must not read as 100% just because it is the best shown.
  const weak = matchScore(TERMS, {
    title: "Energy policy notes",
    passage: "Nuclear output rose modestly last year.",
    article: "Nuclear " + "filler ".repeat(400),
  });
  assert.ok(asPercent(weak.score) < 60, `weak source scored ${asPercent(weak.score)}`);
});

test("a title that addresses the claim beats one that only mentions it", () => {
  const article = "nuclear climate france ".repeat(30);
  const strong = matchScore(TERMS, {
    title: "Nuclear, climate, and France",
    passage: "Nuclear climate France.",
    article,
  });
  const weak = matchScore(TERMS, {
    title: "Quarterly energy roundup",
    passage: "Nuclear climate France.",
    article,
  });
  assert.ok(strong.score > weak.score);
  assert.ok(strong.title > weak.title);
});

test("density is capped so keyword stuffing cannot run the score up", () => {
  const stuffed = matchScore(["nuclear"], {
    title: "Nuclear",
    passage: "Nuclear.",
    article: "nuclear ".repeat(2000),
  });
  assert.ok(stuffed.density <= 1);
  assert.ok(stuffed.score <= 1);
});

test("components are each reported between 0 and 1", () => {
  const m = matchScore(TERMS, {
    title: "Nuclear and climate",
    passage: "France and nuclear.",
    article: "nuclear climate ".repeat(20),
  });
  for (const v of [m.title, m.passage, m.article, m.density, m.score]) {
    assert.ok(v >= 0 && v <= 1, `component out of range: ${v}`);
  }
});

test("empty terms or empty text degrade to zero rather than NaN", () => {
  assert.equal(matchScore([], { title: "x", passage: "y", article: "z" }).score, 0);
  const empty = matchScore(TERMS, { title: "", passage: "", article: "" });
  assert.ok(Number.isFinite(empty.score));
  assert.equal(empty.score, 0);
});

test("word forms count as the same term", () => {
  // A tag says "solves"; the article says "solve". Scoring that as a miss
  // understates the source for no defensible reason.
  const m = matchScore(["solves", "policies"], {
    title: "How policy solved it",
    passage: "The policy solving this was adopted.",
    article: "solve policy ".repeat(20),
  });
  assert.equal(m.title, 1, "solved/policy should match solves/policies");
  assert.equal(m.passage, 1);
});

test("stemming stays light — genuinely different words do not match", () => {
  const m = matchScore(["nuclear"], {
    title: "Unclear guidance on energy",
    passage: "Nothing about reactors here.",
    article: "unclear guidance ".repeat(20),
  });
  assert.equal(m.score, 0, "'unclear' must not match 'nuclear'");
});

test("known weakness: an opposing source still matches topically", () => {
  // Documents the limitation rather than pretending it is solved. Direction
  // is what the trained ranker is for; this score is topical fit only.
  const against = matchScore(["nuclear", "solves", "climate"], {
    title: "Why nuclear does not solve climate change",
    passage: "Nuclear cannot solve climate change in the needed timeframe.",
    article: "nuclear solves climate ".repeat(30),
  });
  assert.ok(
    asPercent(against.score) > 90,
    `a source arguing the opposite still scores ${asPercent(against.score)}%`,
  );
});

test("support, when present, moves the single score", () => {
  const args = {
    title: "Nuclear and climate in France",
    passage: "France uses nuclear for climate goals.",
    article: "nuclear climate france ".repeat(30),
  };
  const supports = matchScore(TERMS, args, 1);
  const opposes = matchScore(TERMS, args, 0);

  // Identical keyword match; only direction differs.
  assert.ok(supports.score > opposes.score);
  assert.ok(asPercent(supports.score) - asPercent(opposes.score) >= 30,
    "direction must be able to outweigh a strong keyword match");
});

test("an opposing source drops below a weaker but supporting one", () => {
  const opposing = matchScore(TERMS, {
    title: "Why nuclear does not help climate goals in France",
    passage: "Nuclear cannot meet France's climate targets.",
    article: "nuclear climate france ".repeat(40),
  }, 0.05);

  const supportingButWeaker = matchScore(TERMS, {
    title: "Energy notes",
    passage: "France's nuclear fleet cut climate emissions sharply.",
    article: "nuclear climate ".repeat(10),
  }, 0.95);

  assert.ok(supportingButWeaker.score > opposing.score,
    "this is the failure the ranker exists to fix");
});

test("without support the score is unchanged from keyword-only weighting", () => {
  const args = { title: "Nuclear climate France", passage: "Nuclear.", article: "nuclear ".repeat(20) };
  const m = matchScore(TERMS, args);
  assert.equal(m.support, undefined);
  assert.ok(m.score > 0);
});

test("an out-of-range support value is clamped, not trusted", () => {
  const args = { title: "Nuclear", passage: "Nuclear.", article: "nuclear ".repeat(20) };
  assert.ok(matchScore(TERMS, args, 5).score <= 1);
  assert.ok(matchScore(TERMS, args, -3).score >= 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractFeatures, termsFromTag, FEATURE_NAMES, fitScaler, applyScaler,
} from "./features.ts";

const F = (name: string) => FEATURE_NAMES.indexOf(name as never);

test("a tag becomes query terms", () => {
  const terms = termsFromTag("Nuclear power solves warming — French grid data proves");
  assert.ok(terms.includes("nuclear"));
  assert.ok(terms.includes("warming"));
  assert.ok(!terms.includes("the"), "stopwords dropped");
});

test("vector length matches the declared names", () => {
  assert.equal(extractFeatures(["nuclear"], "some text here").length, FEATURE_NAMES.length);
});

test("term coverage reflects how many terms are present", () => {
  const terms = ["nuclear", "france", "warming"];
  const both = extractFeatures(terms, "Nuclear reactors in France produce power.");
  const none = extractFeatures(terms, "Completely unrelated prose about baking bread.");
  assert.ok(Math.abs(both[F("termCoverage")] - 2 / 3) < 1e-9);
  assert.equal(none[F("termCoverage")], 0);
});

test("quantities, quotes and credentials are detected", () => {
  const v = extractFeatures(
    ["nuclear"],
    'Professor Chen found nuclear output rose 70 percent, calling it "decisive."',
  );
  assert.equal(v[F("hasQuantity")], 1);
  assert.equal(v[F("hasQuote")], 1);
  assert.equal(v[F("hasCredential")], 1);
});

test("hedge-heavy prose scores higher on hedgeRatio", () => {
  const hedged = extractFeatures(["policy"], "This policy may possibly perhaps potentially work.");
  const firm = extractFeatures(["policy"], "This policy reduced emissions by half.");
  assert.ok(hedged[F("hedgeRatio")] > firm[F("hedgeRatio")]);
});

test("first-match position is earlier when the term leads", () => {
  const early = extractFeatures(["nuclear"], "Nuclear power is dense. " + "Filler. ".repeat(30));
  const late = extractFeatures(["nuclear"], "Filler. ".repeat(30) + "Nuclear power is dense.");
  assert.ok(early[F("firstMatchPosition")] < late[F("firstMatchPosition")]);
});

test("a term that never appears gives position 1, not a negative index", () => {
  const v = extractFeatures(["absent"], "Nothing matching here at all.");
  assert.equal(v[F("firstMatchPosition")], 1);
});

test("empty text yields all zeros rather than NaN", () => {
  const v = extractFeatures(["nuclear"], "");
  assert.equal(v.length, FEATURE_NAMES.length);
  assert.ok(v.every((x) => x === 0), "no NaN or Infinity");
});

test("no feature is ever NaN or Infinite on odd input", () => {
  for (const text of ["...", "   ", "123456", "A", "\n\n\n", "!!!"]) {
    for (const x of extractFeatures(["x", ""], text)) {
      assert.ok(Number.isFinite(x), `non-finite on ${JSON.stringify(text)}`);
    }
  }
});

test("scaler standardizes and survives a constant feature", () => {
  const rows = [
    extractFeatures(["nuclear"], "Nuclear power is dense and reliable for grids."),
    extractFeatures(["nuclear"], "Nuclear reactors in France produce most electricity."),
    extractFeatures(["nuclear"], "Nuclear waste storage remains politically unresolved."),
  ];
  const s = fitScaler(rows);
  assert.ok(s.std.every((v) => v > 0), "zero variance must not become a zero divisor");
  for (const x of applyScaler(rows[0], s)) assert.ok(Number.isFinite(x));
});

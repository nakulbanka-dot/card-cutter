import test from "node:test";
import assert from "node:assert/strict";
import { formatCite, DEFAULT_CITE_OPTIONS } from "./cite-format.ts";
import type { ArticleMetadata } from "./citation.ts";

const ACCESSED = new Date("2026-09-14T00:00:00Z");

const META: ArticleMetadata = {
  authors: ["Jane Nakano", "Yu-Hsuan Yeh"],
  title: "China's Nuclear Energy Priorities",
  container: "Center for Strategic and International Studies",
  published: "2025-09-02T00:00:00Z",
  url: "https://www.csis.org/analysis/china-nuclear",
  missing: [],
};

test("brackets are on by default", () => {
  assert.equal(DEFAULT_CITE_OPTIONS.brackets, true);
  assert.ok(formatCite(META, {}, ACCESSED).includes("["));
});

test("no personal suffix is baked in", () => {
  assert.equal(DEFAULT_CITE_OPTIONS.suffix, "");
  const cite = formatCite(META, {}, ACCESSED);
  assert.ok(!cite.includes("//"), "default cite must carry nobody's initials");
});

test("the spoken head is surnames plus a two-digit year", () => {
  assert.ok(formatCite(META, {}, ACCESSED).startsWith("Nakano and Yeh 25,"));
});

test("a user suffix is appended with the chosen separator", () => {
  const cite = formatCite(META, { suffix: "N.B@UCB" }, ACCESSED);
  assert.ok(cite.endsWith("//N.B@UCB"), cite);

  const dashed = formatCite(META, { suffix: "N.B@UCB", suffixSeparator: "--" }, ACCESSED);
  assert.ok(dashed.endsWith("--N.B@UCB"), dashed);
});

test("brackets can be turned off without losing the detail", () => {
  const plain = formatCite(META, { brackets: false }, ACCESSED);
  assert.ok(!plain.includes("["));
  assert.ok(plain.includes("Jane Nakano and Yu-Hsuan Yeh"));
});

test("access date is included by default and can be dropped", () => {
  assert.ok(formatCite(META, {}, ACCESSED).includes("DOA: 9/14/26"));
  assert.ok(!formatCite(META, { includeAccessDate: false }, ACCESSED).includes("DOA"));
});

test("three or more authors collapse to et al. in the head only", () => {
  const many = { ...META, authors: ["Ada Okonkwo", "Wei Chen", "Jane Doe"] };
  const cite = formatCite(many, {}, ACCESSED);
  assert.ok(cite.startsWith("Okonkwo et al. 25,"));
  // The bracket still lists everyone, so the card can be verified.
  assert.ok(cite.includes("Ada Okonkwo and Wei Chen and Jane Doe"));
});

test("an author-less institutional source falls back to the outlet", () => {
  const org = { ...META, authors: [], missing: ["author"] };
  assert.ok(formatCite(org, {}, ACCESSED).startsWith("Center for Strategic"));
});

test("a missing date drops the year rather than inventing one", () => {
  const undated = { ...META, published: undefined };
  const cite = formatCite(undated, {}, ACCESSED);
  assert.ok(cite.startsWith("Nakano and Yeh,"), cite);
  assert.ok(!/n\.d\.|undefined|NaN/i.test(cite));
});

test("already-inverted author names still yield the surname", () => {
  const inverted = { ...META, authors: ["Nakano, Jane"] };
    assert.ok(formatCite(inverted, {}, ACCESSED).startsWith("Nakano 25,"));
});

test("mla style is available and still takes the suffix", () => {
  const cite = formatCite(META, { style: "mla", suffix: "N.B@UCB" }, ACCESSED);
  assert.ok(cite.includes("Nakano, Jane, and Yu-Hsuan Yeh."));
  assert.ok(cite.endsWith("//N.B@UCB"));
});

test("the url never keeps its protocol", () => {
  assert.ok(!formatCite(META, {}, ACCESSED).includes("https://"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { rankPassages, highlight, hasQuantity } from "./passages.ts";
import { parseQuery, searchVariants } from "./terms.ts";

const ARTICLE = `# Nuclear Power and the Climate Transition

[Home](/) [About](/about) [Contact](/contact) [Subscribe](/sub)

Published March 2026

Nuclear power occupies an unusual position in climate policy debates. The
technology has been available for decades, yet deployment has slowed in most
Western countries since the 1980s for reasons that are largely political
rather than technical in nature.

France generates roughly 70 percent of its electricity from nuclear reactors,
and its grid carbon intensity sits at about 60 grams of CO2 per kilowatt-hour
— roughly one fifth the European average. No country has decarbonized its
electricity supply at comparable speed without relying heavily on either
nuclear power or exceptional hydroelectric geography.

The weather was pleasant that spring in Paris, and the cafes were full.

Critics respond that construction timelines undermine the climate case
entirely. The median reactor completed since 2010 took just over ten years to
build, which places new capacity well outside the window in which emissions
reductions must occur to hold warming near current targets.
`;

test("parseQuery strips filler and keeps content words", () => {
  const p = parseQuery("nuclear power solves climate change");
  // "solves" is gone. It appears in 11,839 corpus tags and in the evidence
  // under them 0.1% of the time, so scoring a passage on it marks that passage
  // down for missing a word no author was going to write.
  assert.deepEqual(p.terms, ["nuclear", "power", "climate", "change"]);
  // The tag itself is kept whole — "solves" versus "prevents" is the whole
  // card, and the models are the things that can tell the difference.
  assert.equal(p.claim, "nuclear power solves climate change");
});

test("a tag made only of debate words still searches for something", () => {
  // Every word here is below the yield threshold. Stripping them all would
  // leave no terms and match nothing, which is worse than matching weakly.
  const p = parseQuery("the counterplan solves the aff");
  assert.ok(p.terms.length > 0, "terms were stripped to nothing");
});

test("search variants widen the net without changing the claim", () => {
  const p = parseQuery("nuclear power solves climate");
  const variants = searchVariants(p);
  assert.ok(variants.includes(p.searchQuery), "the plain query is always tried");
  assert.ok(variants.length >= 2, "and at least one widened form");
  assert.ok(variants.every((v) => v.includes("nuclear")), "the claim is never dropped");
});

test("ranks the evidence paragraph above the irrelevant one", () => {
  const { terms } = parseQuery("nuclear power climate electricity");
  const top = rankPassages(ARTICLE, terms, 3);

  assert.ok(top.length > 0, "expected at least one passage");
  assert.match(top[0].text, /France generates roughly 70 percent/);
  // Expansion may append a neighbour, but an off-topic paragraph must never be
  // what a passage is selected for.
  assert.ok(
    !top[0].text.startsWith("The weather was pleasant"),
    "irrelevant paragraph should never seed a passage",
  );
});

test("drops nav menus and markdown junk", () => {
  const { terms } = parseQuery("nuclear power climate");
  const top = rankPassages(ARTICLE, terms, 10);

  assert.ok(!top.some((p) => p.text.includes("[Subscribe]")), "nav leaked in");
  assert.ok(!top.some((p) => p.text.startsWith("#")), "heading leaked in");
});

test("offsets slice back to the passage text", () => {
  const { terms } = parseQuery("nuclear power climate");
  for (const p of rankPassages(ARTICLE, terms, 4)) {
    assert.equal(ARTICLE.slice(p.start, p.end), p.text);
  }
});

test("returns nothing when no term appears", () => {
  assert.deepEqual(rankPassages(ARTICLE, ["cryptocurrency", "blockchain"]), []);
});

test("highlight marks the matched terms and nothing else", () => {
  const parts = highlight("Nuclear power is cheap", ["nuclear", "power"]);
  assert.deepEqual(
    parts.filter((p) => p.hit).map((p) => p.text),
    ["Nuclear", "power"],
  );
  // Reassembling must give back the original, unchanged.
  assert.equal(parts.map((p) => p.text).join(""), "Nuclear power is cheap");
});

test("highlight survives regex metacharacters in terms", () => {
  const parts = highlight("costs (a lot) more", ["(a lot)"]);
  assert.equal(parts.map((p) => p.text).join(""), "costs (a lot) more");
});

test("highlight marks each term only once, so passages don't fill with yellow", () => {
  const text = "Nuclear power beats nuclear alternatives because nuclear is dense.";
  const parts = highlight(text, ["nuclear"]);
  const hits = parts.filter((p) => p.hit);
  assert.equal(hits.length, 1, "only the first occurrence should be marked");
  assert.equal(parts.map((p) => p.text).join(""), text);
});

test("passages span at least two paragraphs", () => {
  const article = [
    "Nuclear power is contested in climate policy circles for reasons that are largely political rather than technical in nature and origin, a pattern that has held across several decades of energy policy debate in most Western countries.",
    "France generates roughly 70 percent of its electricity from nuclear reactors, and its grid carbon intensity is about one fifth the European average, a gap that has persisted for many years without any serious challenge.",
    "That pace has not been matched by any country relying on renewables alone, which is the comparison that actually matters for policy and the one most often left out of the discussion entirely.",
    "The weather in Paris was pleasant that spring and the cafes along the river were full of people enjoying it, which has nothing to do with anything else written on this page at all.",
  ].join("\n\n");

  const { terms } = parseQuery("nuclear power climate electricity");
  const top = rankPassages(article, terms, 2);

  assert.ok(top.length > 0);
  for (const p of top) {
    assert.ok(p.paragraphCount >= 2, `passage had ${p.paragraphCount} paragraph(s)`);
    // Offsets must still slice back to exactly the passage text.
    assert.equal(article.slice(p.start, p.end), p.text);
  }
});

test("passages do not overlap each other", () => {
  const article = Array.from({ length: 8 }, (_, i) =>
    `Paragraph ${i} discusses nuclear power and climate policy at sufficient length to clear the minimum character threshold for a real passage.`,
  ).join("\n\n");

  const { terms } = parseQuery("nuclear power climate");
  const top = rankPassages(article, terms, 3);

  const sorted = [...top].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].start >= sorted[i - 1].end, "passages overlapped");
  }
});

test("a short article still yields a passage rather than nothing", () => {
  const article = [
    "Nuclear power supplies a large share of French electricity today.".repeat(4),
    "Climate policy debates turn on that comparison more than on anything else.".repeat(3),
  ].join("\n\n");
  const { terms } = parseQuery("nuclear power climate");
  assert.ok(rankPassages(article, terms, 4).length > 0);
});

test("citation strings and tables are filtered out as non-prose", () => {
  const { terms } = parseQuery("property rights transplantation law");
  const article = [
    "17 Russell v. Freeman, 202 Okl. 417, 214 P.2d 439, 441-42 (1950); Gade v. Loffler, 171 Okl. 313, 42 P.2d 815, 818 (1935); McNeal v. Baker, 135 Okl. 159, 274 P. 655, 656 (1929); Smith v. Jones, 110 Okl. 22, 233 P. 190, 192 (1925) (property rights in transplantation law).",
    "Compensation systems would change the nature of altruistic organ donation under current property rights doctrine. The theory states that people may be more willing to provide organs if they receive compensation, and several types of transplantation law reform have been proposed to that end.",
    "The theory has been tested in a handful of jurisdictions where property rights over donated tissue were clarified by statute, and the results in transplantation law have been mixed but instructive for policymakers considering similar reform.",
  ].join("\n\n");

  const top = rankPassages(article, terms, 3);
  assert.ok(top.length > 0, "real prose should survive");
  assert.ok(
    !top.some((p) => p.text.startsWith("17 Russell v. Freeman")),
    "a string of case citations is not a cuttable passage",
  );
});

test("a quantified claim is recognised, a date is not", () => {
  // Measured within-article across 63,278 labelled paragraphs: percentages,
  // money and magnitudes predict what gets cut (1.13-1.18x); a bare year is
  // 0.98x, which is nothing. Marking years would add noise while looking like
  // a feature.
  assert.ok(hasQuantity("emissions fell 43 percent since the policy began"));
  assert.ok(hasQuantity("emissions fell 43% since the policy began"));
  assert.ok(hasQuantity("the programme cost $4 billion over a decade"));
  assert.ok(hasQuantity("roughly 2.3 million households were affected"));

  assert.equal(hasQuantity("the treaty was signed in 1990 and ratified later"), false);
  assert.equal(hasQuantity("there were 7 people in the room at the time"), false);
  assert.equal(hasQuantity("no numbers appear anywhere in this sentence"), false);
});

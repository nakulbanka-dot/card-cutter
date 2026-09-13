import test from "node:test";
import assert from "node:assert/strict";
import { rankPassages, highlight } from "./passages.ts";
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
  assert.deepEqual(p.terms, ["nuclear", "power", "solves", "climate", "change"]);
  assert.equal(p.wantsRefutation, false);
});

test("parseQuery detects a request for the other side", () => {
  const p = parseQuery("answers to nuclear power solves climate");
  assert.equal(p.wantsRefutation, true);
  assert.ok(!p.searchQuery.startsWith("answers to"));
  assert.ok(searchVariants(p).some((v) => v.includes("against")));
});

test("ranks the evidence paragraph above the irrelevant one", () => {
  const { terms } = parseQuery("nuclear power climate electricity");
  const top = rankPassages(ARTICLE, terms, 3);

  assert.ok(top.length > 0, "expected at least one passage");
  assert.match(top[0].text, /France generates roughly 70 percent/);
  assert.ok(
    !top.some((p) => p.text.includes("cafes were full")),
    "irrelevant paragraph should not surface",
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

import test from "node:test";
import assert from "node:assert/strict";
import { parseCardsFromHtml } from "./parse-html.ts";
import { mergeSpans } from "./types.ts";

// Shaped like openCaselist / Verbatim HTML export.
const HTML = `
<h4>Nuclear solves warming — French grid data proves</h4>
<p>Chen 26 (Wei Chen, Professor of Energy Policy at MIT, Brookings, 3/12/26, https://www.brookings.edu/articles/nuclear-grid)</p>
<p>Setting aside the politics, <u>France generates roughly 70 percent of its electricity from nuclear reactors</u>, and its grid carbon intensity sits at <mark>one fifth the European average</mark>. No country has matched that pace.</p>
<h4>Timelines are not prohibitive</h4>
<p>Okonkwo 25 (Ada Okonkwo, IEA analyst, 8/1/25)</p>
<p>Critics point to build times, but <span style="text-decoration: underline">the median reactor since 2020 took six years</span>, well inside the policy window that anyone actually cares about here.</p>
`;

test("splits disclosure HTML into separate cards", () => {
  assert.equal(parseCardsFromHtml(HTML, "wiki.html").length, 2);
});

test("recovers the tag from the heading", () => {
  const [first] = parseCardsFromHtml(HTML, "wiki.html");
  assert.equal(first.tag, "Nuclear solves warming — French grid data proves");
});

test("<u> spans slice back exactly", () => {
  const [first] = parseCardsFromHtml(HTML, "wiki.html");
  assert.deepEqual(
    mergeSpans(first.underlines).map((s) => first.body.slice(s.start, s.end)),
    ["France generates roughly 70 percent of its electricity from nuclear reactors"],
  );
});

test("<mark> is captured as highlight, not underline", () => {
  const [first] = parseCardsFromHtml(HTML, "wiki.html");
  assert.deepEqual(
    first.highlights.map((s) => first.body.slice(s.start, s.end)),
    ["one fifth the European average"],
  );
});

test("inline style underline is recognized too", () => {
  const [, second] = parseCardsFromHtml(HTML, "wiki.html");
  assert.deepEqual(
    mergeSpans(second.underlines).map((s) => second.body.slice(s.start, s.end)),
    ["the median reactor since 2020 took six years"],
  );
});

test("the cite yields a source URL for negative mining", () => {
  const [first] = parseCardsFromHtml(HTML, "wiki.html");
  assert.equal(first.sourceUrl, "https://www.brookings.edu/articles/nuclear-grid");
});

test("entities are decoded in the body", () => {
  const cards = parseCardsFromHtml(
    `<h4>Trade deficits matter</h4><p>Lee 24, https://e.org/x</p>
     <p>The ratio of imports &amp; exports shifted sharply, and <u>the gap widened by 12&#37;</u> across the period under review by the commission.</p>`,
    "x.html",
  );
  assert.ok(cards[0].body.includes("imports & exports"));
  assert.ok(cards[0].body.includes("12%"));
});

test("a body with no markup at all still parses", () => {
  const cards = parseCardsFromHtml(
    `<h4>Simple claim</h4><p>Doe 23</p><p>${"A long unmarked passage. ".repeat(15)}</p>`,
    "y.html",
  );
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].underlines, []);
});

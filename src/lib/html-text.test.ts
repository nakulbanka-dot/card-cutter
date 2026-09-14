import test from "node:test";
import assert from "node:assert/strict";
import { extractParagraphs } from "./html-text.ts";

const LONG = (s: string) => s + " " + "Additional supporting prose to clear the length threshold for a real paragraph.".repeat(2);

const PAGE = `<html><head><style>.x{color:red}</style></head><body>
<nav><p>${LONG("Home About Contact Subscribe now")}</p></nav>
<article>
  <h1>Headline</h1>
  <p>${LONG("France generates roughly 70 percent of its electricity from nuclear reactors.")}</p>
  <p>Too short.</p>
  <p>${LONG("Critics respond that construction timelines undermine the case.")}</p>
  <p>${LONG("We use cookies to improve your experience on this site.")}</p>
</article>
<footer><p>${LONG("Copyright notice and terms of service information here.")}</p></footer>
</body></html>`;

test("keeps article prose", () => {
  const paras = extractParagraphs(PAGE);
  assert.ok(paras.some((p) => p.includes("France generates roughly 70 percent")));
  assert.ok(paras.some((p) => p.includes("construction timelines")));
});

test("drops nav, footer and style blocks wholesale", () => {
  const paras = extractParagraphs(PAGE).join(" ");
  assert.ok(!paras.includes("Home About Contact"), "nav leaked");
  assert.ok(!paras.includes("Copyright notice"), "footer leaked");
  assert.ok(!paras.includes("color:red"), "css leaked");
});

test("drops boilerplate and short fragments", () => {
  const paras = extractParagraphs(PAGE);
  assert.ok(!paras.some((p) => p.startsWith("We use cookies")));
  assert.ok(!paras.some((p) => p === "Too short."));
});

test("decodes entities", () => {
  const paras = extractParagraphs(
    `<p>${LONG("Guns &amp; butter &mdash; the &ldquo;real&rdquo; tradeoff.")}</p>`,
  );
  assert.ok(paras[0].includes("Guns & butter"));
  assert.ok(paras[0].includes("“real”"));
});

test("requires sentence punctuation, so link lists are skipped", () => {
  const linky = `<p>${"Politics Business Sport Culture Travel Money Tech Science ".repeat(6)}</p>`;
  assert.deepEqual(extractParagraphs(linky), []);
});

test("deduplicates a paragraph the template repeats", () => {
  const dup = `<p>${LONG("Support our journalism today.")}</p>`.repeat(3);
  assert.equal(extractParagraphs(dup).length, 1);
});

test("malformed html yields nothing rather than throwing", () => {
  assert.deepEqual(extractParagraphs("<p>unclosed"), []);
  assert.deepEqual(extractParagraphs(""), []);
});

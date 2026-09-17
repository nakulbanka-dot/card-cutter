import test from "node:test";
import assert from "node:assert/strict";
import { cardHtml, cardText } from "./card-html.ts";
import type { Sentence } from "./ranking/highlighter.ts";

const passage = "France leads on nuclear. The weather was nice. No country matched it.";
const sentences: Sentence[] = [
  { text: "France leads on nuclear.", start: 0, end: 24, mark: true },
  { text: "The weather was nice.", start: 25, end: 46, mark: false },
  { text: "No country matched it.", start: 47, end: 69, mark: true },
];
const parts = { tag: "Nuclear solves", cite: "Smith 24", sentences, passage };

test("underlines only the marked sentences", () => {
  const html = cardHtml(parts);
  assert.ok(html.includes("<u>France leads on nuclear.</u>"));
  assert.ok(html.includes("<u>No country matched it.</u>"));
  assert.ok(!html.includes("<u>The weather was nice.</u>"));
});

test("the body is the passage, character for character", () => {
  // The guarantee the product rests on: what you paste is what the article
  // said. Stripping the markup must give back the original exactly.
  const body = cardHtml(parts).split('9pt;">')[1].replace("</p>", "");
  const plain = body.replace(/<\/?u>/g, "").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.equal(plain, passage);
});

test("text between sentences is never dropped", () => {
  // The splitter skips fragments and citation-like runs, so a card rebuilt
  // from sentence texts alone would lose whatever fell between them.
  const gappy = "Short. France leads on nuclear and it matters a great deal here.";
  const html = cardHtml({
    ...parts,
    passage: gappy,
    sentences: [{ text: "France leads on nuclear and it matters a great deal here.", start: 7, end: 64, mark: true }],
  });
  assert.ok(html.includes("Short."), "the skipped fragment was dropped");
});

test("escapes markup so an article cannot inject tags", () => {
  const nasty = "Before <script>alert(1)</script> after.";
  const html = cardHtml({
    ...parts, passage: nasty,
    sentences: [{ text: nasty, start: 0, end: nasty.length, mark: false }],
  });
  assert.ok(!html.includes("<script>"), "raw script tag survived");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("plain text carries the card whole, without faking underlines", () => {
  const t = cardText(parts);
  assert.ok(t.includes("Nuclear solves") && t.includes("Smith 24"));
  assert.ok(t.includes(passage));
  assert.ok(!t.includes("*"), "underlining should not be simulated");
});

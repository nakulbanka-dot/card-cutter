import test from "node:test";
import assert from "node:assert/strict";
import { toMLA, mlaAuthors, invertName, mlaDate } from "./citation.ts";
import { extractMetadata } from "./metadata.ts";

const ACCESSED = new Date("2026-09-13T00:00:00Z");

const JSONLD_PAGE = `<html><head>
<title>Nuclear Power and the Grid | Brookings</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"NewsArticle",
 "headline":"Nuclear Power and the Grid",
 "author":[{"@type":"Person","name":"Wei Chen"}],
 "datePublished":"2026-03-12T09:00:00Z",
 "publisher":{"@type":"Organization","name":"Brookings Institution"}}
</script></head><body></body></html>`;

const META_PAGE = `<html><head>
<meta property="og:site_name" content="The Atlantic">
<meta name="citation_author" content="Jane Doe">
<meta name="citation_author" content="John Smith">
<meta property="og:title" content="The Case Against Speed">
<meta property="article:published_time" content="2025-11-02">
</head></html>`;

test("name inversion", () => {
  assert.equal(invertName("Wei Chen"), "Chen, Wei");
  assert.equal(invertName("Chen, Wei"), "Chen, Wei");
  assert.equal(invertName("Brookings"), "Brookings");
});

test("MLA author element by count", () => {
  assert.equal(mlaAuthors(["Wei Chen"]), "Chen, Wei");
  assert.equal(mlaAuthors(["Wei Chen", "John Smith"]), "Chen, Wei, and John Smith");
  assert.equal(mlaAuthors(["A B", "C D", "E F"]), "B, A, et al.");
  assert.equal(mlaAuthors([]), undefined);
});

test("MLA date abbreviations", () => {
  assert.equal(mlaDate("2026-03-12T09:00:00Z"), "12 Mar. 2026");
  assert.equal(mlaDate("2026-05-01"), "1 May 2026");
  assert.equal(mlaDate("2026-09-30"), "30 Sept. 2026");
  assert.equal(mlaDate("not a date"), undefined);
});

test("JSON-LD produces a complete citation", () => {
  const meta = extractMetadata(JSONLD_PAGE, "https://www.brookings.edu/articles/nuclear");
  assert.deepEqual(meta.authors, ["Wei Chen"]);
  assert.equal(meta.title, "Nuclear Power and the Grid");
  assert.deepEqual(meta.missing, []);

  assert.equal(
    toMLA(meta, ACCESSED),
    'Chen, Wei. "Nuclear Power and the Grid." Brookings Institution, 12 Mar. 2026, ' +
      "www.brookings.edu/articles/nuclear. Accessed 13 Sept. 2026.",
  );
});

test("meta tags work when there is no JSON-LD, including two authors", () => {
  const meta = extractMetadata(META_PAGE, "https://www.theatlantic.com/x");
  assert.deepEqual(meta.authors, ["Jane Doe", "John Smith"]);
  assert.equal(meta.container, "The Atlantic");
  assert.ok(toMLA(meta, ACCESSED).startsWith('Doe, Jane, and John Smith. "The Case Against Speed."'));
});

test("a missing author is omitted, never invented", () => {
  const meta = extractMetadata(
    '<html><head><title>Untitled Report</title></head></html>',
    "https://example.org/report",
  );
  assert.deepEqual(meta.authors, []);
  assert.ok(meta.missing.includes("author"));

  const cite = toMLA(meta, ACCESSED);
  assert.ok(cite.startsWith('"Untitled Report."'), cite);
  assert.ok(!/anonymous|n\.d\./i.test(cite));
});

test("html entities are decoded in titles", () => {
  const meta = extractMetadata(
    '<html><head><meta property="og:title" content="Guns &amp; Butter: The &quot;Real&quot; Tradeoff"></head></html>',
    "https://example.org/a",
  );
  assert.equal(meta.title, 'Guns & Butter: The "Real" Tradeoff');
});

test("malformed JSON-LD falls through to meta tags instead of throwing", () => {
  const page = `<html><head>
    <script type="application/ld+json">{ this is not json }</script>
    <meta name="author" content="Real Person">
    <meta property="og:title" content="Still Works">
  </head></html>`;
  const meta = extractMetadata(page, "https://example.org/b");
  assert.deepEqual(meta.authors, ["Real Person"]);
  assert.equal(meta.title, "Still Works");
});

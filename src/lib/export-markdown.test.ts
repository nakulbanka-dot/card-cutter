import test from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "./export-markdown.ts";
import type { FindResponse } from "./pipeline/free.ts";

const RESULT: FindResponse = {
  query: "nuclear power solves climate change",
  usingKey: false,
  terms: ["nuclear", "power", "climate"],
  wantsRefutation: false,
  sources: [
    {
      url: "https://example.org/nuclear",
      title: "Nuclear and the Grid",
      publishedAt: "2026-03-01",
      body: "full article text",
      mla: 'Chen, Wei. "Nuclear and the Grid." Brookings Institution, 1 Mar. 2026, example.org/nuclear. Accessed 13 Sept. 2026.',
      missingCiteFields: [],
      metadata: {
        authors: ["Wei Chen"],
        title: "Nuclear and the Grid",
        container: "Brookings Institution",
        published: "2026-03-01",
        url: "https://example.org/nuclear",
        missing: [],
      },
      passages: [
        {
          text: "France generates roughly 70 percent of its electricity\nfrom nuclear reactors.",
          start: 0,
          end: 74,
          score: 1.2,
          matched: ["nuclear"],
        },
      ],
    },
  ],
  skipped: [],
};

test("carries the claim and the direction", () => {
  const md = toMarkdown(RESULT);
  assert.ok(md.includes("CLAIM: nuclear power solves climate change"));
  assert.ok(md.includes("SUPPORTS"));
});

test("instructs verbatim copying", () => {
  const md = toMarkdown(RESULT).toLowerCase();
  assert.ok(md.includes("word for word"));
  assert.ok(md.includes("fabricated card"));
});

test("includes the cite details and blockquotes every passage line", () => {
  const md = toMarkdown(RESULT);
  assert.ok(md.includes("URL: https://example.org/nuclear"));
  assert.ok(md.includes("MLA: Chen, Wei."), "MLA line should be in the export");
  assert.ok(md.includes("1 Mar. 2026"), "date travels inside the MLA line");
  // Both lines of the wrapped passage must be quoted, not just the first.
  assert.ok(md.includes("> France generates roughly 70 percent of its electricity"));
  assert.ok(md.includes("> from nuclear reactors."));
});

test("refutation flips the direction line", () => {
  const md = toMarkdown({ ...RESULT, wantsRefutation: true });
  assert.ok(md.includes("REFUTES"));
  assert.ok(!md.includes("I want evidence that SUPPORTS"));
});

test("handles an empty result without throwing", () => {
  const md = toMarkdown({ ...RESULT, sources: [] });
  assert.ok(md.includes("No sources found"));
});

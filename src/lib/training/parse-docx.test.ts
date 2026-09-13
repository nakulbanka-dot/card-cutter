import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseDocx } from "./parse-docx.ts";
import { underlineRatio, mergeSpans } from "./types.ts";

/** A run of text, optionally underlined/highlighted, as Word writes it. */
function run(text: string, opts: { u?: boolean; hl?: boolean; b?: boolean } = {}) {
  const props =
    (opts.b ? "<w:b/>" : "") +
    (opts.u ? '<w:u w:val="single"/>' : "") +
    (opts.hl ? '<w:highlight w:val="yellow"/>' : "");
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function para(runs: string, style?: string) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

const TAG_1 = "Nuclear solves warming — French grid data proves";
const CITE_1 =
  'Chen 26 (Wei Chen, Professor of Energy Policy at MIT, "Nuclear and the Grid," Brookings, 3/12/26, https://www.brookings.edu/articles/nuclear-grid)';

function buildDocx(documentXml: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships/>'),
    "word/document.xml": strToU8(documentXml),
  });
}

const DOC = buildDocx(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  ${para(run("Nuclear Power Good", { b: true }), "Heading1")}
  ${para(run(TAG_1, { b: true }), "Tag")}
  ${para(run(CITE_1), "Cite")}
  ${para(
    run("Setting aside the politics, ") +
      run("France generates roughly 70 percent of its electricity from nuclear reactors", { u: true }) +
      run(", and its grid carbon intensity sits at about ") +
      run("one fifth the European average", { u: true, hl: true }) +
      run(". No country has decarbonized at comparable speed without it.",
  ))}
  ${para(run("Construction timelines are not prohibitive", { b: true }), "Tag")}
  ${para(run("Okonkwo 25 (Ada Okonkwo, IEA analyst, 8/1/25)"), "Cite")}
  ${para(
    run("Critics point to build times, but ") +
      run("the median reactor completed since 2020 took just over six years", { u: true }) +
      run(", which is well inside the window that matters for emissions policy and planning.",
  ))}
</w:body></w:document>`);

test("parses both cards out of one document", () => {
  const cards = parseDocx(DOC, "test.docx");
  assert.equal(cards.length, 2);
});

test("the tag is recovered and is usable as a query", () => {
  const [first] = parseDocx(DOC, "test.docx");
  assert.equal(first.tag, TAG_1);
  // The whole premise: a tag is a short natural-language statement of want.
  assert.ok(first.tag.split(/\s+/).length <= 12);
});

test("the body is verbatim and excludes the tag and cite", () => {
  const [first] = parseDocx(DOC, "test.docx");
  assert.ok(first.body.startsWith("Setting aside the politics,"));
  assert.ok(!first.body.includes(TAG_1));
  assert.ok(!first.body.includes("Professor of Energy Policy"));
});

test("underline spans slice back to exactly what was underlined", () => {
  const [first] = parseDocx(DOC, "test.docx");
  const underlined = mergeSpans(first.underlines).map((s) =>
    first.body.slice(s.start, s.end),
  );
  assert.deepEqual(underlined, [
    "France generates roughly 70 percent of its electricity from nuclear reactors",
    "one fifth the European average",
  ]);
});

test("highlighting is tracked separately from underlining", () => {
  const [first] = parseDocx(DOC, "test.docx");
  const hl = first.highlights.map((s) => first.body.slice(s.start, s.end));
  assert.deepEqual(hl, ["one fifth the European average"]);
});

test("the source URL is pulled from the cite for negative mining", () => {
  const [first] = parseDocx(DOC, "test.docx");
  assert.equal(first.sourceUrl, "https://www.brookings.edu/articles/nuclear-grid");
});

test("a cite without a URL yields no sourceUrl rather than a bad one", () => {
  const [, second] = parseDocx(DOC, "test.docx");
  assert.equal(second.sourceUrl, undefined);
  assert.ok(second.cite.includes("Okonkwo"));
});

test("underline ratio is a sane compression number", () => {
  const [first] = parseDocx(DOC, "test.docx");
  const ratio = underlineRatio(first);
  assert.ok(ratio > 0.2 && ratio < 0.8, `ratio was ${ratio}`);
});

test("works without style names, on formatting alone", () => {
  // Plenty of real files have no Verbatim styles applied at all.
  const bare = buildDocx(`<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      ${para(run("Warming is reversible", { b: true }))}
      ${para(run("Nakamura 24, https://example.org/a"))}
      ${para(
        run("A long passage that runs past the length threshold so it is treated as a body paragraph rather than a tag, and it contains ") +
          run("an underlined portion", { u: true }) +
          run(" that we expect to be recovered correctly.",
      ))}
    </w:body></w:document>`);

  const cards = parseDocx(bare, "bare.docx");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].tag, "Warming is reversible");
  assert.equal(cards[0].sourceUrl, "https://example.org/a");
  assert.deepEqual(
    cards[0].underlines.map((s) => cards[0].body.slice(s.start, s.end)),
    ["an underlined portion"],
  );
});

test("rejects a file that is not a Word document", () => {
  const notDocx = zipSync({ "hello.txt": strToU8("nope") });
  assert.throws(() => parseDocx(notDocx, "x.docx"), /not a Word document/);
});

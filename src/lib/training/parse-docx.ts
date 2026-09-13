import { unzipSync, strFromU8 } from "fflate";
import { type ParsedCard, type Span, urlFromCite } from "./types.ts";

/**
 * Parse cut cards out of a Verbatim/Word .docx.
 *
 * Classification is by formatting rather than by style name alone. Verbatim
 * template style names drift between versions and between people's setups, but
 * the shape of a card doesn't: a short bold line (tag), a line with a date or
 * URL (cite), then a long passage with underlined runs (body). Leaning on shape
 * means this works on files that were never set up "correctly".
 */

interface Run {
  text: string;
  underlined: boolean;
  highlighted: boolean;
  bold: boolean;
}

interface Para {
  runs: Run[];
  text: string;
  style: string;
}

/** XML entity decode for the handful OOXML actually emits. */
function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function parseParagraphs(xml: string): Para[] {
  const paras: Para[] = [];

  for (const pMatch of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const inner = pMatch[1];
    const style = inner.match(/<w:pStyle\s+w:val="([^"]*)"/)?.[1] ?? "";

    // Paragraph-level formatting applies to runs that don't override it.
    const pPr = inner.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? "";
    const paraBold = /<w:b\/>|<w:b\s+w:val="(?:1|true)"/.test(pPr);

    const runs: Run[] = [];
    for (const rMatch of inner.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const r = rMatch[1];
      const rPr = r.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? "";

      // Collect every <w:t> in the run; a run can hold several.
      let text = "";
      for (const t of r.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
        text += decode(t[1]);
      }
      // Tabs and breaks are real whitespace in the body.
      if (/<w:tab\/>/.test(r)) text += "\t";
      if (/<w:br\/>/.test(r)) text += "\n";
      if (!text) continue;

      const uVal = rPr.match(/<w:u\s+w:val="([^"]*)"/)?.[1];
      const hVal = rPr.match(/<w:highlight\s+w:val="([^"]*)"/)?.[1];

      runs.push({
        text,
        // w:val="none" explicitly turns underlining off.
        underlined: Boolean(uVal && uVal !== "none"),
        highlighted: Boolean(hVal && hVal !== "none"),
        bold: /<w:b\/>|<w:b\s+w:val="(?:1|true)"/.test(rPr) || paraBold,
      });
    }

    const text = runs.map((r) => r.text).join("");
    if (text.trim() || runs.length) paras.push({ runs, text, style });
  }

  return paras;
}

type Kind = "tag" | "cite" | "body" | "structure" | "skip";

/** Cites carry a year and usually a name or URL; tags carry neither. */
function looksLikeCite(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/https?:\/\//.test(t)) return true;
  // "Chen 24", "Smith '19", "(2026)", "Mar. 12, 2026"
  return /\b(19|20)\d{2}\b/.test(t) || /\b[A-Z][a-z]+\s+'?\d{2}\b/.test(t);
}

function classify(p: Para): Kind {
  const text = p.text.trim();
  if (!text) return "skip";

  const style = p.style.toLowerCase();
  if (/^heading[1-3]$|^h[1-3]$/.test(style)) return "structure";
  if (style.includes("tag")) return "tag";
  if (style.includes("cite")) return "cite";

  const hasMarking = p.runs.some((r) => r.underlined || r.highlighted);

  // A marked or long paragraph is the card body. Underlining is the strongest
  // signal there is — nobody underlines a tag.
  if (hasMarking || text.length > 250) return "body";

  if (looksLikeCite(text)) return "cite";
  if (p.runs.some((r) => r.bold) || text.length < 250) return "tag";

  return "body";
}

/** Concatenate body paragraphs, tracking where the marked runs land. */
function buildBody(paras: Para[]): {
  body: string;
  underlines: Span[];
  highlights: Span[];
} {
  let body = "";
  const underlines: Span[] = [];
  const highlights: Span[] = [];

  paras.forEach((p, i) => {
    if (i > 0) body += "\n";
    for (const run of p.runs) {
      const start = body.length;
      body += run.text;
      const span = { start, end: body.length };
      if (run.underlined) underlines.push(span);
      if (run.highlighted) highlights.push({ ...span });
    }
  });

  return { body, underlines, highlights };
}

export function parseCardsFromDocxXml(xml: string, source: string): ParsedCard[] {
  const paras = parseParagraphs(xml);
  const cards: ParsedCard[] = [];

  let tag = "";
  let cite = "";
  let bodyParas: Para[] = [];

  const flush = () => {
    // A card needs a tag and a body; a stray heading isn't a card.
    if (!tag || bodyParas.length === 0) {
      tag = "";
      cite = "";
      bodyParas = [];
      return;
    }
    const { body, underlines, highlights } = buildBody(bodyParas);
    if (body.trim().length >= 100) {
      cards.push({
        tag: tag.trim(),
        cite: cite.trim(),
        body,
        underlines,
        highlights,
        sourceUrl: urlFromCite(cite),
        source,
      });
    }
    tag = "";
    cite = "";
    bodyParas = [];
  };

  for (const p of paras) {
    switch (classify(p)) {
      case "tag":
        // A new tag means the previous card is finished.
        if (bodyParas.length > 0) flush();
        tag = tag ? `${tag} ${p.text}` : p.text;
        break;
      case "cite":
        if (bodyParas.length > 0) flush();
        cite = cite ? `${cite} ${p.text}` : p.text;
        break;
      case "body":
        bodyParas.push(p);
        break;
      case "structure":
        flush();
        break;
      default:
        break;
    }
  }
  flush();

  return cards;
}

/** Parse a .docx file's bytes. */
export function parseDocx(bytes: Uint8Array, source: string): ParsedCard[] {
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error(`${source}: not a Word document (no word/document.xml)`);
  return parseCardsFromDocxXml(strFromU8(doc), source);
}

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

/**
 * Verbatim writes tags as Heading4. That is the single most reliable signal in
 * a real file — measured across this corpus, Heading4 appears hundreds of times
 * per handful of files while the "Tag" style appears twice. Cites, by contrast,
 * usually carry no style at all and often no year ("Valovic this month"), so
 * they cannot be identified by their text; they are identified by sitting
 * directly between a tag and its body.
 */
const TAG_STYLES = /^(heading4|h4|tag|cardtag)$/;
const STRUCTURE_STYLES = /^(heading[1-3]|h[1-3])$/;

/**
 * A full debate cite — author, credential, outlet, date, URL — routinely runs
 * past any sane length cutoff, so length alone would classify it as body text
 * and swallow it into the card. Identify it by what it contains instead.
 */
function looksLikeCite(text: string): boolean {
  return (
    /\b(19|20)\d{2}\b/.test(text) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text) ||
    /https?:\/\//.test(text) ||
    /\[/.test(text) ||
    /\b(professor|senior fellow|fellow at|analyst|director|reporter|correspondent|published|ph\.?d|j\.?d\.)\b/i.test(
      text,
    )
  );
}

/** Verbatim leaves editing markers in the text; they are not content. */
function isNoise(text: string): boolean {
  const t = text.trim();
  return !t || /^<<.*>>$/.test(t) || /^[-=_*#\s]+$/.test(t);
}

function classify(
  p: Para,
  state: { hasTag: boolean; hasCite: boolean; hasBody: boolean },
  strict: boolean,
): Kind {
  const text = p.text.trim();
  if (isNoise(text)) return "skip";

  const style = p.style.toLowerCase().replace(/\s+/g, "");
  if (STRUCTURE_STYLES.test(style)) return "structure";
  if (TAG_STYLES.test(style)) return "tag";
  if (style.includes("cite")) return "cite";

  const marked = p.runs.some((r) => r.underlined || r.highlighted);

  // The cite sits between the tag and the body, and is never marked up. Check
  // this before the length rule, or a long cite gets eaten as body text.
  if (!marked && state.hasTag && !state.hasCite && !state.hasBody && looksLikeCite(text)) {
    return "cite";
  }

  // Marked or long: card body. Underlining and highlighting are the strongest
  // signals available — nobody marks up a tag.
  if (marked || text.length > 250) return "body";

  // Short and unmarked. Directly after a tag with no body yet, it is the cite.
  // Anywhere else it is an analytic, a block header, or a stray line — which is
  // exactly the material that used to be promoted into thousands of fake cards.
  if (state.hasTag && !state.hasCite && !state.hasBody) return "cite";

  // Loose pass only: some files come from templates that never applied
  // Heading4, so a short unmarked line opening a card is allowed to be the tag.
  if (!strict && !state.hasTag) return "tag";

  return "skip";
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

function collect(paras: Para[], source: string, strict: boolean): ParsedCard[] {
  const cards: ParsedCard[] = [];

  let tag = "";
  let cite = "";
  let bodyParas: Para[] = [];

  const flush = () => {
    // A card is a tag plus a body. Anything missing either is not a card.
    if (tag && bodyParas.length > 0) {
      const { body, underlines, highlights } = buildBody(bodyParas);
      if (body.trim().length >= 150) {
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
    }
    tag = "";
    cite = "";
    bodyParas = [];
  };

  for (const p of paras) {
    const state = { hasTag: Boolean(tag), hasCite: Boolean(cite), hasBody: bodyParas.length > 0 };
    switch (classify(p, state, strict)) {
      case "tag":
        flush();
        tag = p.text;
        break;
      case "cite":
        cite = cite ? `${cite} ${p.text}` : p.text;
        break;
      case "body":
        // A body with no tag above it belongs to no card.
        if (tag) bodyParas.push(p);
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

/**
 * Strict first — a styled Heading4 tag is the reliable signal, and requiring it
 * keeps analytics and block headers from being promoted into fake cards. Only
 * if a document yields nothing that way do we fall back to shape alone, which
 * recovers files whose template never applied the styles.
 */
export function parseCardsFromDocxXml(xml: string, source: string): ParsedCard[] {
  const paras = parseParagraphs(xml);
  const strict = collect(paras, source, true);
  return strict.length > 0 ? strict : collect(paras, source, false);
}

/** Parse a .docx file's bytes. */
export function parseDocx(bytes: Uint8Array, source: string): ParsedCard[] {
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new Error(`${source}: not a Word document (no word/document.xml)`);
  return parseCardsFromDocxXml(strFromU8(doc), source);
}

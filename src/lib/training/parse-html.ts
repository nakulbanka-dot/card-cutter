import { type ParsedCard, type Span, urlFromCite } from "./types.ts";

/**
 * Parse cut cards out of HTML — openCaselist disclosure, or Verbatim's own
 * HTML export.
 *
 * Same shape as the .docx path: <h4>/<strong> is the tag, a line with a year
 * or URL is the cite, and <u>/<mark> mark what gets read aloud. Disclosure
 * HTML is messier than Word XML, so this leans harder on shape than on tags.
 */

interface Token {
  text: string;
  underlined: boolean;
  highlighted: boolean;
}

const BLOCK = /<(h[1-6]|p|div|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Walk inline markup, tracking underline/highlight state as tags open and close. */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  // Stacks, not counters: a closing tag carries no attributes, so the only way
  // to know whether </span> ends an underline is to remember that its opening
  // tag started one.
  const uStack: string[] = [];
  const hStack: string[] = [];
  let i = 0;

  const isHighlightTag = (tag: string, attrs: string) =>
    tag === "mark" ||
    /background(-color)?\s*:/i.test(attrs) ||
    /\bclass\s*=\s*"[^"]*(highlight|hilite)/i.test(attrs);

  const isUnderlineTag = (tag: string, attrs: string) =>
    tag === "u" ||
    tag === "ins" ||
    /text-decoration\s*:[^;"']*underline/i.test(attrs);

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      const text = decode(html.slice(i));
      if (text) tokens.push({ text, underlined: uStack.length > 0, highlighted: hStack.length > 0 });
      break;
    }

    if (lt > i) {
      const text = decode(html.slice(i, lt));
      if (text) tokens.push({ text, underlined: uStack.length > 0, highlighted: hStack.length > 0 });
    }

    const gt = html.indexOf(">", lt);
    if (gt === -1) break;

    const raw = html.slice(lt + 1, gt);
    const closing = raw.startsWith("/");
    const name = raw.replace(/^\//, "").split(/[\s>]/)[0].toLowerCase();
    const attrs = raw.slice(name.length + (closing ? 1 : 0));

    const selfClosing = raw.trimEnd().endsWith("/");

    if (closing) {
      if (uStack[uStack.length - 1] === name) uStack.pop();
      if (hStack[hStack.length - 1] === name) hStack.pop();
    } else if (!selfClosing) {
      if (isUnderlineTag(name, attrs)) uStack.push(name);
      if (isHighlightTag(name, attrs)) hStack.push(name);
    }

    i = gt + 1;
  }

  return tokens;
}

function looksLikeCite(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/https?:\/\//.test(t)) return true;
  return /\b(19|20)\d{2}\b/.test(t) || /\b[A-Z][a-z]+\s+'?\d{2}\b/.test(t);
}

export function parseCardsFromHtml(html: string, source: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  let tag = "";
  let cite = "";
  let bodyTokens: Token[] = [];

  const flush = () => {
    if (tag && bodyTokens.length) {
      let body = "";
      const underlines: Span[] = [];
      const highlights: Span[] = [];

      for (const t of bodyTokens) {
        const start = body.length;
        body += t.text;
        const span = { start, end: body.length };
        if (t.underlined) underlines.push(span);
        if (t.highlighted) highlights.push({ ...span });
      }

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
    }
    tag = "";
    cite = "";
    bodyTokens = [];
  };

  for (const block of html.matchAll(BLOCK)) {
    const [, tagName, inner] = block;
    // Nested blocks are handled by their own match; skip containers.
    if (/<(p|h[1-6]|li)\b/i.test(inner)) continue;

    const tokens = tokenize(inner);
    const text = tokens.map((t) => t.text).join("").trim();
    if (!text) continue;

    const marked = tokens.some((t) => t.underlined || t.highlighted);
    const isHeading = /^h[1-6]$/i.test(tagName);

    if (marked || text.length > 250) {
      bodyTokens.push(...tokens);
      continue;
    }

    // Unmarked, short: a tag or a cite, and either one starts a new card.
    if (bodyTokens.length > 0) flush();
    if (looksLikeCite(text)) cite = cite ? `${cite} ${text}` : text;
    else if (isHeading || !tag) tag = tag ? `${tag} ${text}` : text;
  }

  flush();
  return cards;
}

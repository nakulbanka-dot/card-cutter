import type { Sentence } from "./ranking/highlighter";

/**
 * A cut card, as Word will receive it.
 *
 * Copying plain text loses the underlining, which is the entire point of
 * cutting — a card without it is just a quotation, and the debater has to
 * redo the pass by hand in Verbatim. Writing text/html to the clipboard means
 * Word pastes the marks intact.
 *
 * The conventions here are Verbatim's, because that is what the card is going
 * into: the tag bold on its own line, the citation bold beneath it, then the
 * body at a smaller size with the underlined sentences marked. Unmarked text
 * stays in the card rather than being dropped — it is the context that makes
 * the underlining honest, and a reader can ask for it.
 */

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface CardParts {
  tag: string;
  cite: string;
  sentences: Sentence[];
  /** The passage the sentences came from, for the text between them. */
  passage: string;
}

/**
 * Rebuild the passage with marks, preserving everything between sentences.
 *
 * Joining the sentence texts would silently drop whatever fell between them —
 * the splitter skips fragments under five words and anything that looks like a
 * citation, so a card assembled from sentences alone would quietly lose words
 * the author wrote. Slicing by offset keeps the passage exactly as published,
 * which is the guarantee the whole product rests on.
 */
function markedBody(passage: string, sentences: Sentence[]): string {
  let out = "";
  let at = 0;
  for (const s of sentences) {
    if (s.start > at) out += escape(passage.slice(at, s.start));
    const text = escape(passage.slice(s.start, s.end));
    out += s.mark ? `<u>${text}</u>` : text;
    at = s.end;
  }
  if (at < passage.length) out += escape(passage.slice(at));
  return out;
}

/** HTML for the clipboard. Word reads this and keeps the underlining. */
export function cardHtml({ tag, cite, sentences, passage }: CardParts): string {
  return [
    `<p style="font-family:Calibri,sans-serif;font-size:12pt;"><b>${escape(tag)}</b></p>`,
    `<p style="font-family:Calibri,sans-serif;font-size:11pt;"><b>${escape(cite)}</b></p>`,
    `<p style="font-family:Calibri,sans-serif;font-size:9pt;">${markedBody(passage, sentences)}</p>`,
  ].join("");
}

/**
 * The same card as plain text, for anywhere that cannot take HTML.
 *
 * Underlining cannot survive here, so it is not faked with asterisks or
 * brackets — that would have to be stripped out by hand on the other side.
 * The card arrives whole and unmarked, which is what plain text can carry.
 */
export function cardText({ tag, cite, passage }: CardParts): string {
  return `${tag}\n\n${cite}\n\n${passage}`;
}

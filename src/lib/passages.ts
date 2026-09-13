/**
 * Ranking paragraphs, without a model.
 *
 * This is what free mode actually sells: instead of handing you a 4,000-word
 * article, it points at the handful of paragraphs most likely to contain the
 * card. You make the call on which one is the warrant — the part you're
 * better at than a cheap model is anyway.
 *
 * The scoring is transparent on purpose. You should be able to look at a
 * ranking and see why a paragraph surfaced.
 */

export interface Passage {
  text: string;
  /** Offsets into the article body, so the UI can link back to context. */
  start: number;
  end: number;
  score: number;
  /** Which query terms appear here — drives highlighting. */
  matched: string[];
}

/** Below this a paragraph is a heading or a caption, not evidence. */
const MIN_CHARS = 180;
/** Above this it's usually a wall of scraped nav junk. */
const MAX_CHARS = 2_400;

/** Split into paragraphs, keeping each one's offset into the original text. */
function paragraphs(body: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;

  for (const m of body.matchAll(re)) {
    const text = m[0].trim();
    if (text) out.push({ text, start: m.index + m[0].indexOf(text[0]) });
  }
  return out;
}

/** Markdown artifacts and nav text that extraction leaves behind. */
function isJunk(text: string): boolean {
  if (/^[#>*\-|=\s\d.]+$/.test(text)) return true;
  if (/^!?\[.*\]\(.*\)$/.test(text)) return true;
  // Link-dense lines are menus, not prose.
  const links = (text.match(/\]\(/g) ?? []).length;
  return links >= 3;
}

/** Evidence tends to carry numbers; it's a weak but real signal. */
function hasQuantity(text: string): boolean {
  return /\b\d{1,3}(,\d{3})*(\.\d+)?\s?(%|percent|billion|million|trillion)\b/i.test(
    text,
  );
}

export function rankPassages(
  body: string,
  terms: string[],
  limit = 4,
): Passage[] {
  if (terms.length === 0) return [];

  const lowerTerms = terms.map((t) => t.toLowerCase());
  const scored: Passage[] = [];

  for (const { text, start } of paragraphs(body)) {
    if (text.length < MIN_CHARS || text.length > MAX_CHARS) continue;
    if (isJunk(text)) continue;

    const lower = text.toLowerCase();
    const matched = lowerTerms.filter((t) => lower.includes(t));
    if (matched.length === 0) continue;

    // Distinct terms matter more than repetition — a paragraph touching three
    // of your concepts beats one that says the same word five times.
    let score = matched.length / lowerTerms.length;

    // Repetition still counts, but with sharply diminishing returns.
    const hits = lowerTerms.reduce(
      (n, t) => n + (lower.split(t).length - 1),
      0,
    );
    score += Math.log1p(hits) * 0.15;

    if (hasQuantity(text)) score += 0.2;
    // Quotation marks usually mean an attributed claim.
    if (/[""]|"/.test(text)) score += 0.1;

    scored.push({ text, start, end: start + text.length, score, matched });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Split a passage into runs for highlighting matched terms in the UI. */
export function highlight(
  text: string,
  terms: string[],
): { text: string; hit: boolean }[] {
  if (terms.length === 0) return [{ text, hit: false }];

  const escaped = terms
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (escaped.length === 0) return [{ text, hit: false }];

  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;

  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });

  return parts;
}

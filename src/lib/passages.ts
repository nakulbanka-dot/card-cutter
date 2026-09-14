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
  /** How many paragraphs this passage spans. */
  paragraphCount: number;
}

/**
 * Minimum paragraphs per passage. A one-paragraph card is usually too short to
 * read — you want the claim plus the warrant that follows it, and that almost
 * always runs past a paragraph break.
 */
const MIN_PARAGRAPHS_PER_PASSAGE = 2;

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
  const paras = paragraphs(body);

  // Score each paragraph on its own, then expand the winners. Scoring the
  // window instead would let one strong paragraph drag a weak neighbour up
  // the ranking, or bury a strong paragraph next to a weak one.
  const scored: { index: number; score: number; matched: string[] }[] = [];

  paras.forEach(({ text }, index) => {
    if (text.length < MIN_CHARS || text.length > MAX_CHARS) return;
    if (isJunk(text)) return;

    const lower = text.toLowerCase();
    const matched = lowerTerms.filter((t) => lower.includes(t));
    if (matched.length === 0) return;

    // Distinct terms matter more than repetition — a paragraph touching three
    // of your concepts beats one that says the same word five times.
    let score = matched.length / lowerTerms.length;

    const hits = lowerTerms.reduce((n, t) => n + (lower.split(t).length - 1), 0);
    score += Math.log1p(hits) * 0.15;

    if (hasQuantity(text)) score += 0.2;
    if (/[\u201c\u201d]|"/.test(text)) score += 0.1;

    scored.push({ index, score, matched });
  });

  scored.sort((a, b) => b.score - a.score);

  const out: Passage[] = [];
  const used = new Set<number>();

  for (const seed of scored) {
    if (out.length >= limit) break;
    if (used.has(seed.index)) continue;

    // Expand to the minimum length. Prefer forward — a card is normally the
    // claim plus the warrant that follows it — but prefer a neighbour that
    // mentions the query over one that doesn't, so expanding never drags an
    // unrelated paragraph into the passage just to make up the length.
    const window = [seed.index];

    const usable = (i: number) =>
      i >= 0 && i < paras.length && !used.has(i) && !isJunk(paras[i].text);
    const onTopic = (i: number) =>
      usable(i) &&
      lowerTerms.some((t) => paras[i].text.toLowerCase().includes(t));

    while (window.length < MIN_PARAGRAPHS_PER_PASSAGE) {
      const forward = window[window.length - 1] + 1;
      const backward = window[0] - 1;

      if (onTopic(forward)) window.push(forward);
      else if (onTopic(backward)) window.unshift(backward);
      else if (usable(forward)) window.push(forward);
      else if (usable(backward)) window.unshift(backward);
      else break; // Start or end of the article — one paragraph is all there is.
    }

    for (const i of window) used.add(i);

    const first = paras[window[0]];
    const last = paras[window[window.length - 1]];
    const start = first.start;
    const end = last.start + last.text.length;

    out.push({
      text: body.slice(start, end),
      start,
      end,
      score: seed.score,
      matched: seed.matched,
      paragraphCount: window.length,
    });
  }

  return out;
}

/**
 * Split a passage into runs for highlighting matched terms.
 *
 * Only the FIRST occurrence of each term is marked. In an article about
 * nuclear power the word "nuclear" appears in every other sentence, and
 * marking all of them produced 60 highlights on a single source — at which
 * point nothing is highlighted, because everything is. One mark per term
 * still answers "why did this match" without turning the passage into
 * a wall of yellow.
 */
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
  const seen = new Set<string>();
  let last = 0;

  for (const m of text.matchAll(re)) {
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });

  return parts;
}

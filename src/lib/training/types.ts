/**
 * A card that has already been cut, parsed back into training data.
 *
 * The insight this file rests on: a cut card is a completed labeling task.
 * The tag is the query the debater had in mind, the body is the passage they
 * chose over everything else in the article, and the underlining marks which
 * words carried the argument. Nobody has to sit down and label anything —
 * the labels were created as a side effect of cutting.
 */

export interface Span {
  start: number;
  end: number;
}

export interface ParsedCard {
  /** The tag. Doubles as the query — it's what the debater was looking for. */
  tag: string;
  /** Raw cite line as printed, e.g. "Chen 24 (Wei Chen, Professor...)". */
  cite: string;
  /** Card body, verbatim. */
  body: string;
  /** Underlined spans — the words read aloud. Offsets into `body`. */
  underlines: Span[];
  /** Highlighted spans, where the debater used highlighting instead of (or on top of) underlining. */
  highlights: Span[];
  /** Source URL if the cite contains one. Needed for negative mining. */
  sourceUrl?: string;
  /** Which file this came from, for tracing a bad example back. */
  source: string;
}

/** Pull the first URL out of a cite line. */
export function urlFromCite(cite: string): string | undefined {
  const m = cite.match(/https?:\/\/[^\s<>"')\]]+/);
  if (!m) return undefined;
  // Cites often end with a period that isn't part of the URL.
  return m[0].replace(/[.,;]+$/, "");
}

/** Merge overlapping/adjacent spans so highlighting doesn't double-render. */
export function mergeSpans(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [{ ...sorted[0] }];

  for (const s of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Share of the body that is underlined — a debater's compression ratio. */
export function underlineRatio(card: ParsedCard): number {
  if (!card.body.length) return 0;
  const marked = mergeSpans(card.underlines).reduce(
    (n, s) => n + (s.end - s.start),
    0,
  );
  return marked / card.body.length;
}

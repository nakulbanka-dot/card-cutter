/**
 * Domain vocabulary for the cutting pipeline.
 *
 * Debate terms, for anyone reading this who doesn't cut cards:
 *  - tag        the one-line claim the card is read for
 *  - cite       author, credential, publication, date
 *  - card body  the verbatim passage, unedited
 *  - underline  which spans of the body get read out loud
 */

/** The whole user-facing input: five to ten words. */
export interface CutRequest {
  /** e.g. "AI regulation kills innovation" */
  query: string;
  /** How many sources to fan out to. Defaults to DEFAULT_SOURCE_LIMIT. */
  limit?: number;
}

/** A candidate article, before anything has been cut out of it. */
export interface Source {
  url: string;
  title: string;
  /** Full extracted text. Never truncated — the cutter needs the whole thing. */
  body: string;
  publishedAt?: string;
  author?: string;
  publication?: string;
}

/** Author credential — the part that decides whether the card is any good. */
export interface Cite {
  author: string;
  /** e.g. "Professor of Economics, MIT" */
  qualification?: string;
  publication: string;
  /** ISO-8601 where we can determine it. */
  date?: string;
  url: string;
}

/** A character range into `body`, marking text that gets read aloud. */
export interface Underline {
  start: number;
  end: number;
}

/** One finished card. */
export interface Card {
  tag: string;
  cite: Cite;
  /** Verbatim from the source. Must appear in Source.body unchanged. */
  body: string;
  underlines: Underline[];
  /** Why this passage supports the tag. For review, not for the doc. */
  rationale?: string;
}

export interface CutResponse {
  query: string;
  cards: Card[];
  /** Sources we searched but cut nothing from, and why. */
  rejected: { url: string; reason: string }[];
}

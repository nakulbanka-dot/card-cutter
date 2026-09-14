import type { ArticleMetadata } from "./citation.ts";
import { mlaDate, toMLA } from "./citation.ts";

/**
 * Debate-style citations.
 *
 * A works-cited MLA entry is not what goes above a card. Debate cites lead
 * with the author and year so they can be said out loud ("Nakano and Yeh 25"),
 * then carry the qualifications, outlet, date and URL in brackets for anyone
 * who calls for the card, and end with the initials of whoever cut it.
 *
 * Every part of that is a preference, so every part is an option. The defaults
 * match what most templates do; nothing here is hardcoded to a person.
 */

export interface CiteOptions {
  /** Appended at the end, e.g. "N.B@UCB". Empty means omit. */
  suffix: string;
  /** Goes before the suffix. Commonly "//". */
  suffixSeparator: string;
  /** Wrap the detail block in [ ]. On by default. */
  brackets: boolean;
  /** Include the date the source was retrieved. */
  includeAccessDate: boolean;
  /** Debate cite, or a plain MLA works-cited entry. */
  style: "debate" | "mla";
}

export const DEFAULT_CITE_OPTIONS: CiteOptions = {
  suffix: "",
  suffixSeparator: "//",
  brackets: true,
  includeAccessDate: true,
  style: "debate",
};

/** Surnames only, for the spoken part of the cite. */
function surnames(authors: string[]): string | undefined {
  const last = authors
    .map((a) => {
      const clean = a.trim().replace(/\s+/g, " ");
      if (!clean) return "";
      // Already inverted ("Chen, Wei") — the surname is what precedes the comma.
      if (clean.includes(",")) return clean.split(",")[0].trim();
      const parts = clean.split(" ");
      return parts[parts.length - 1];
    })
    .filter(Boolean);

  if (last.length === 0) return undefined;
  if (last.length === 1) return last[0];
  if (last.length === 2) return `${last[0]} and ${last[1]}`;
  return `${last[0]} et al.`;
}

/** Two-digit year, the way a cite is spoken: 2026 -> 26. */
function shortYear(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return String(d.getUTCFullYear()).slice(-2);
}

/** Numeric date for the bracket block: 12 Mar 2026 -> 3/12/26. */
function slashDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function formatCite(
  meta: ArticleMetadata,
  options: Partial<CiteOptions> = {},
  accessed: Date = new Date(),
): string {
  const o = { ...DEFAULT_CITE_OPTIONS, ...options };

  if (o.style === "mla") {
    const base = toMLA(meta, accessed);
    return o.suffix ? `${base} ${o.suffixSeparator}${o.suffix}` : base;
  }

  // ---- spoken head: "Nakano and Yeh 25" ----
  const names = surnames(meta.authors);
  const yr = shortYear(meta.published);
  const head = [names ?? meta.container ?? "No author", yr].filter(Boolean).join(" ");

  // ---- bracketed detail ----
  const detail: string[] = [];
  if (meta.authors.length > 0) detail.push(meta.authors.join(" and "));
  // Only name the outlet here if it isn't already standing in as the author.
  if (meta.container && names) detail.push(meta.container);
  if (meta.title) detail.push(`"${meta.title.replace(/["“”]/g, "")}"`);

  const d = slashDate(meta.published);
  if (d) detail.push(d);
  if (o.includeAccessDate) detail.push(`DOA: ${slashDate(accessed.toISOString())}`);
  detail.push(stripProtocol(meta.url));

  const body = detail.join(", ");
  const bracketed = o.brackets ? `[${body}]` : body;

  const tail = o.suffix ? ` ${o.suffixSeparator}${o.suffix}` : "";
  return `${head}, ${bracketed}${tail}`;
}

/** Which fields are missing, phrased for a reader rather than a developer. */
export function citeGaps(meta: ArticleMetadata): string[] {
  const gaps: string[] = [];
  if (meta.authors.length === 0) gaps.push("author");
  if (!meta.published) gaps.push("date");
  if (!meta.title) gaps.push("title");
  return gaps;
}

export { mlaDate };

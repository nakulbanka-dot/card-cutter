/**
 * MLA 9 citations, built from the page's own metadata.
 *
 * No model involved. Publishers already declare author, date, and publication
 * in JSON-LD and meta tags because search engines require it — so this is a
 * parsing problem, not a judgment problem, and parsing is free and exact.
 *
 * Every field is optional. MLA explicitly allows omitting elements that don't
 * exist, so a missing author degrades to a title-first citation rather than
 * inventing a name. Guessing an author is a worse failure than omitting one.
 */

export interface ArticleMetadata {
  /** Author names as printed, e.g. ["Wei Chen", "John Smith"]. */
  authors: string[];
  /**
   * What an author is, keyed by their printed name — "Senior Fellow, Brookings".
   *
   * A cite without quals is weaker in a round: the other team asks who this
   * person is and the answer is nothing. Publishers routinely ship it in the
   * page's own markup and it was being thrown away, so this costs no extra
   * request. Absent for authors whose page said nothing.
   */
  authorQuals?: Record<string, string>;
  /** Article headline. */
  title?: string;
  /** The website or publication, e.g. "Brookings Institution". */
  container?: string;
  /** Publisher, when it differs from the container. */
  publisher?: string;
  /** ISO date string if we found one. */
  published?: string;
  url: string;
  /** Which fields we could not determine — surfaced so the user can fill them. */
  missing: string[];
}

const MONTHS = [
  "Jan.", "Feb.", "Mar.", "Apr.", "May", "June",
  "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec.",
];

/** MLA date: 12 Mar. 2026 */
export function mlaDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Wei Chen" -> "Chen, Wei". Left alone if it's already inverted or a org. */
export function invertName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || clean.includes(",")) return clean;

  const parts = clean.split(" ");
  if (parts.length < 2) return clean;

  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}

/** MLA 9 author element: 1 inverted, 2 joined by "and", 3+ becomes et al. */
export function mlaAuthors(authors: string[]): string | undefined {
  const names = authors.map((a) => a.trim()).filter(Boolean);
  if (names.length === 0) return undefined;
  if (names.length === 1) return invertName(names[0]);
  if (names.length === 2) return `${invertName(names[0])}, and ${names[1]}`;
  return `${invertName(names[0])}, et al.`;
}

/** Strip protocol and trailing slash — MLA drops "https://". */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * Assemble an MLA 9 works-cited entry. Elements that are absent are skipped,
 * which is what MLA prescribes rather than inserting "n.d." or "Anonymous".
 */
export function toMLA(meta: ArticleMetadata, accessed: Date = new Date()): string {
  const parts: string[] = [];

  const author = mlaAuthors(meta.authors);
  if (author) parts.push(`${author.replace(/\.$/, "")}.`);

  if (meta.title) parts.push(`"${meta.title.replace(/["""]/g, "")}."`);
  if (meta.container) parts.push(`${meta.container},`);
  if (meta.publisher && meta.publisher !== meta.container) {
    parts.push(`${meta.publisher},`);
  }

  const date = mlaDate(meta.published);
  if (date) parts.push(`${date},`);

  parts.push(`${displayUrl(meta.url)}.`);
  parts.push(`Accessed ${mlaDate(accessed.toISOString())}.`);

  return parts.join(" ");
}

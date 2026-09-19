import type { ArticleMetadata } from "./citation";

/**
 * Pull author/date/publication out of a page's own markup.
 *
 * Publishers declare this in JSON-LD and meta tags because search engines and
 * social previews demand it. That makes citation a parsing job rather than a
 * judgment call — exact, free, and not something a model should be guessing at.
 *
 * Source priority: JSON-LD (richest and most standardized) -> citation_* meta
 * tags (used by academic publishers) -> OpenGraph -> plain meta -> <title>.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

/** Read <meta name="x"> or <meta property="x">, whichever is present. */
function metaTag(html: string, key: string): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${k}["'][^>]*>`,
    "i",
  );
  const tag = html.match(re)?.[0];
  if (!tag) return undefined;

  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
  const value = content ? decodeEntities(content) : "";
  return value || undefined;
}

/** All values for a repeated meta key (multiple authors). */
function metaTagAll(html: string, key: string): string[] {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${k}["'][^>]*>`,
    "gi",
  );
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const c = m[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (c) out.push(decodeEntities(c));
  }
  return out;
}

interface JsonLdNode {
  "@type"?: string | string[];
  headline?: string;
  name?: string;
  author?: unknown;
  datePublished?: string;
  dateCreated?: string;
  dateModified?: string;
  publisher?: { name?: string } | string;
  isPartOf?: { name?: string };
  "@graph"?: JsonLdNode[];
}

const ARTICLE_TYPES = /article|report|blogposting|newsarticle|scholarlyarticle/i;

/** Author can be a string, an object, or an array of either. */
function authorNames(author: unknown): string[] {
  if (!author) return [];
  if (typeof author === "string") return [author];
  if (Array.isArray(author)) return author.flatMap(authorNames);
  if (typeof author === "object") {
    const name = (author as { name?: unknown }).name;
    if (typeof name === "string") return [name];
  }
  return [];
}

/**
 * What the page says an author IS, not just what they are called.
 *
 * schema.org Person carries jobTitle, affiliation and description, and a
 * surprising number of publishers fill them in. It was all being discarded by
 * authorNames, which only ever wanted the name — so the qualification a
 * debater needs was already on the page and already fetched.
 *
 * Longer prose bios are trimmed to the first sentence. A cite is read aloud,
 * and three sentences about someone's book tour is not a qualification.
 */
const MAX_QUAL_CHARS = 160;

function authorQuals(author: unknown, into: Record<string, string> = {}): Record<string, string> {
  if (!author || typeof author !== "object") return into;
  if (Array.isArray(author)) {
    author.forEach((a) => authorQuals(a, into));
    return into;
  }

  const a = author as {
    name?: unknown;
    jobTitle?: unknown;
    description?: unknown;
    affiliation?: unknown;
    worksFor?: unknown;
  };
  if (typeof a.name !== "string" || !a.name.trim()) return into;

  const orgOf = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const n = (v as { name?: unknown }).name;
      if (typeof n === "string") return n;
    }
    return undefined;
  };

  const parts = [
    typeof a.jobTitle === "string" ? a.jobTitle : undefined,
    orgOf(a.affiliation) ?? orgOf(a.worksFor),
  ].filter((x): x is string => Boolean(x && x.trim()));

  let qual = parts.join(", ");
  if (!qual && typeof a.description === "string" && a.description.trim()) {
    // First sentence only; a cite is read out loud.
    qual = a.description.trim().split(/(?<=[.!?])\s/)[0];
  }

  qual = qual.replace(/\s+/g, " ").trim();
  if (qual) into[a.name.trim()] = qual.slice(0, MAX_QUAL_CHARS);
  return into;
}

function fromJsonLd(html: string): Partial<ArticleMetadata> {
  const blocks = html.matchAll(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue; // Malformed JSON-LD is common; just move on.
    }

    // Flatten @graph and top-level arrays into candidate nodes.
    const nodes: JsonLdNode[] = [];
    const push = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      const node = n as JsonLdNode;
      nodes.push(node);
      if (Array.isArray(node["@graph"])) node["@graph"].forEach(push);
    };
    if (Array.isArray(parsed)) parsed.forEach(push);
    else push(parsed);

    for (const node of nodes) {
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      if (!types.some((t) => typeof t === "string" && ARTICLE_TYPES.test(t))) {
        continue;
      }

      const publisher =
        typeof node.publisher === "string" ? node.publisher : node.publisher?.name;

      const quals = authorQuals(node.author);
      return {
        authors: authorNames(node.author),
        authorQuals: Object.keys(quals).length > 0 ? quals : undefined,
        title: node.headline ?? node.name,
        published: node.datePublished ?? node.dateCreated ?? node.dateModified,
        publisher,
        container: node.isPartOf?.name ?? publisher,
      };
    }
  }

  return {};
}

/**
 * Author bios written into the page rather than into schema.org.
 *
 * Structured data turned out to be nearly empty for this: across 40 real
 * articles only one of the 28 with an author carried anything in JSON-LD, and
 * that one was the publication's own name, which tells a debater nothing.
 * Publishers do write bios — they just write them as markup next to the
 * byline instead of as metadata.
 */
const BIO_PATTERNS: RegExp[] = [
  // <div class="author-bio">…</div> and its many spellings.
  /<[^>]+class=["'][^"']*(?:author[-_]?bio|byline[-_]?bio|contributor[-_]?bio|author[-_]?description|bio[-_]?text)[^"']*["'][^>]*>([\s\S]{0,600}?)<\//i,
  /<meta[^>]+name=["'](?:author\.description|citation_author_institution)["'][^>]+content=["']([^"']{4,300})["']/i,
  /<[^>]+itemprop=["']description["'][^>]*>([\s\S]{0,400}?)<\//i,
];

/** Strip tags and collapse whitespace. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * A qualification has to say something the cite does not already.
 *
 * "Canada's National Observer" as an author's affiliation is the outlet the
 * article is already attributed to; printing it after their name reads as a
 * qualification and is not one.
 */
export function usefulQual(qual: string, author: string, container?: string): boolean {
  const q = qual.trim();
  if (q.length < 8) return false;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (container && norm(q) === norm(container)) return false;
  if (norm(q) === norm(author)) return false;
  return true;
}

function bioFromHtml(html: string): string | undefined {
  for (const re of BIO_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const t = textOf(m[1]);
    if (t.length >= 8) return t.split(/(?<=[.!?])\s/)[0].slice(0, 160);
  }
  return undefined;
}

/**
 * Institutional pages — think IEA, C2ES, government reports — routinely ship
 * no date meta tag, and the date is exactly what a debate cite needs. Fall
 * back to a <time datetime> element, then to a visible date near the top.
 */
function dateFromBody(html: string): string | undefined {
  const timeTag = html.match(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i)?.[1];
  if (timeTag && !Number.isNaN(new Date(timeTag).getTime())) return timeTag;

  // "March 12, 2026" or "12 March 2026" in the first chunk of markup.
  const head = html.slice(0, 60_000);
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December";
  const written =
    head.match(new RegExp(`\\b(${months})\\s+(\\d{1,2}),\\s*(\\d{4})\\b`, "i")) ??
    head.match(new RegExp(`\\b(\\d{1,2})\\s+(${months})\\s+(\\d{4})\\b`, "i"));
  if (written) {
    const d = new Date(written[0]);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

/** Site name from the hostname, as a last resort: "brookings.edu" -> "Brookings". */
function siteFromHost(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const name = host.split(".")[0];
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : undefined;
  } catch {
    return undefined;
  }
}

export function extractMetadata(html: string, url: string): ArticleMetadata {
  const ld = fromJsonLd(html);

  const authors =
    ld.authors && ld.authors.length > 0
      ? ld.authors
      : [
          ...metaTagAll(html, "citation_author"),
          ...metaTagAll(html, "article:author"),
          ...metaTagAll(html, "author"),
          ...metaTagAll(html, "parsely-author"),
        ].filter((a) => a && !/^https?:/.test(a));

  const title =
    ld.title ??
    metaTag(html, "citation_title") ??
    metaTag(html, "og:title") ??
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") ??
    undefined;

  const container =
    ld.container ??
    metaTag(html, "og:site_name") ??
    metaTag(html, "citation_journal_title") ??
    siteFromHost(url);

  const published =
    ld.published ??
    metaTag(html, "article:published_time") ??
    metaTag(html, "citation_publication_date") ??
    metaTag(html, "citation_date") ??
    metaTag(html, "date") ??
    metaTag(html, "dc.date") ??
    metaTag(html, "article:modified_time") ??
    dateFromBody(html);

  // Dedupe authors case-insensitively, preserving printed form.
  const seen = new Set<string>();
  const uniqueAuthors = authors.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const missing: string[] = [];
  if (uniqueAuthors.length === 0) missing.push("author");
  if (!published) missing.push("date");
  if (!title) missing.push("title");

  // Only keep quals for authors that survived deduping, so the map can never
  // name someone the citation does not.
  const found: Record<string, string> = Object.fromEntries(
    Object.entries(ld.authorQuals ?? {}).filter(([name]) =>
      uniqueAuthors.some((a) => a.toLowerCase() === name.toLowerCase()),
    ),
  );

  // A bio in the markup applies to the byline, so it is only safe to attach
  // when there is exactly one author to attach it to.
  if (uniqueAuthors.length === 1 && !found[uniqueAuthors[0]]) {
    const bio = bioFromHtml(html);
    // Only if the bio actually names them. A block matching one of these
    // patterns is often the site's own tagline — "Insight and inspiration in
    // turbulent times" came back as an author qualification — and a real bio
    // says who the person is, which means saying their name.
    const surname = uniqueAuthors[0].trim().split(/\s+/).pop() ?? "";
    if (bio && surname.length > 2 && bio.toLowerCase().includes(surname.toLowerCase())) {
      found[uniqueAuthors[0]] = bio;
    }
  }

  const quals = Object.fromEntries(
    Object.entries(found).filter(([name, q]) => usefulQual(q, name, container)),
  );

  return {
    authors: uniqueAuthors,
    authorQuals: Object.keys(quals).length > 0 ? quals : undefined,
    title: title || undefined,
    container,
    publisher: ld.publisher,
    published,
    url,
    missing,
  };
}

/** Fetch a page and parse its metadata. Plain fetch — no API, no cost. */
export async function fetchMetadata(url: string): Promise<ArticleMetadata> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some publishers serve a stub to unknown agents.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Only the <head> matters, and articles can be megabytes.
    const html = (await res.text()).slice(0, 200_000);
    return extractMetadata(html, url);
  } catch {
    return {
      authors: [],
      url,
      container: siteFromHost(url),
      missing: ["author", "date", "title"],
    };
  }
}

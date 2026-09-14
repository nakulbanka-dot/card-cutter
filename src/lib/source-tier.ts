/**
 * Source classification.
 *
 * Where evidence comes from decides how much weight a judge gives it, so the
 * outlet is worth surfacing before anyone reads the passage. This is a
 * deliberate, readable list rather than a model — you should be able to
 * disagree with a placement and go change it.
 */

export type Category =
  | "Peer-reviewed"
  | "Government"
  | "Academic"
  | "Think tank"
  | "Major news"
  | "News"
  | "Other";

export interface SourceTier {
  category: Category;
  /** 1 is strongest. Roughly how a judge weighs it, not a quality score. */
  tier: 1 | 2 | 3 | 4;
}

const JOURNALS = [
  "nature.com", "science.org", "sciencedirect.com", "springer.com",
  "link.springer.com", "wiley.com", "onlinelibrary.wiley.com", "tandfonline.com",
  "sagepub.com", "journals.sagepub.com", "jstor.org", "doi.org", "arxiv.org",
  "ssrn.com", "papers.ssrn.com", "pubmed.ncbi.nlm.nih.gov", "nejm.org",
  "thelancet.com", "bmj.com", "pnas.org", "cambridge.org", "oup.com",
  "academic.oup.com", "mdpi.com", "frontiersin.org", "plos.org",
];

const THINK_TANKS = [
  "brookings.edu", "cato.org", "csis.org", "cfr.org", "rand.org",
  "carnegieendowment.org", "aei.org", "heritage.org", "piie.com",
  "chathamhouse.org", "atlanticcouncil.org", "wilsoncenter.org",
  "urban.org", "epi.org", "nber.org", "iea.org", "c2es.org",
  "bakerinstitute.org", "hoover.org", "manhattan-institute.org",
];

const MAJOR_NEWS = [
  "nytimes.com", "washingtonpost.com", "wsj.com", "reuters.com", "apnews.com",
  "bloomberg.com", "economist.com", "ft.com", "theguardian.com", "bbc.com",
  "bbc.co.uk", "npr.org", "politico.com", "foreignpolicy.com",
  "foreignaffairs.com", "theatlantic.com", "nature.org",
];

const NEWS = [
  "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "axios.com",
  "thehill.com", "vox.com", "slate.com", "newsweek.com", "time.com",
  "forbes.com", "businessinsider.com", "cnbc.com", "aljazeera.com",
];

/** Blogging and self-publishing platforms — no editorial standing of their own. */
const SELF_PUBLISHED = [
  "medium.com", "substack.com", "wordpress.com", "blogspot.com",
  "tumblr.com", "reddit.com", "quora.com", "linkedin.com",
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when host is the domain or a subdomain of it. */
const matches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

export function classifySource(url: string): SourceTier {
  const host = hostOf(url);
  if (!host) return { category: "Other", tier: 4 };

  if (SELF_PUBLISHED.some((d) => matches(host, d))) {
    return { category: "Other", tier: 4 };
  }
  if (JOURNALS.some((d) => matches(host, d))) {
    return { category: "Peer-reviewed", tier: 1 };
  }
  // Repositories live under .edu but publish working papers and law reviews.
  if (host.endsWith(".edu") || host.includes("digitalcommons")) {
    return { category: "Academic", tier: 1 };
  }
  if (host.endsWith(".gov") || host.endsWith(".mil")) {
    return { category: "Government", tier: 2 };
  }
  if (THINK_TANKS.some((d) => matches(host, d))) {
    return { category: "Think tank", tier: 2 };
  }
  if (MAJOR_NEWS.some((d) => matches(host, d))) {
    return { category: "Major news", tier: 2 };
  }
  if (NEWS.some((d) => matches(host, d))) {
    return { category: "News", tier: 3 };
  }
  // Intergovernmental and standards bodies sit with government.
  if (host.endsWith(".int") || host.endsWith(".un.org")) {
    return { category: "Government", tier: 2 };
  }
  if (host.endsWith(".org")) return { category: "Think tank", tier: 3 };

  return { category: "Other", tier: 4 };
}

/** Archive fallback for a source that turned out to be paywalled. */
export function archiveUrl(url: string): string {
  return `https://archive.is/newest/${encodeURIComponent(url)}`;
}

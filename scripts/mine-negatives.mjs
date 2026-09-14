/**
 * Mine hard negatives from the articles your cards came from.
 *
 * The openCaselist corpus cannot teach cuttability: every card in it was cut,
 * so there are no examples of a paragraph a debater read and rejected. But
 * each of your own cards names its source. Re-fetch that article and every
 * OTHER paragraph in it is exactly that — a paragraph you had in front of you
 * and passed over. Those are the negatives, and they are far stronger than
 * random prose because they survived the same search and the same read.
 *
 * Plain HTTP, so this costs nothing. Many links are years old, so a large
 * share will be dead or paywalled; that is expected and reported.
 *
 *   node scripts/mine-negatives.mjs [--limit N] [--concurrency N]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile, mkdir, appendFile } from "node:fs/promises";
import { extractParagraphs } from "../src/lib/html-text.ts";
import { findVerbatim } from "../src/lib/verbatim.ts";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const LIMIT = arg("limit", 0);
const CONCURRENCY = arg("concurrency", 8);
const OUT = "data/training/negatives.jsonl";

// ---- group cards by the article they came from ----
const byUrl = new Map();
const rl = createInterface({ input: createReadStream("data/cards.jsonl"), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let c;
  try { c = JSON.parse(line); } catch { continue; }
  if (!c.sourceUrl || typeof c.body !== "string" || typeof c.tag !== "string") continue;
  if (c.body.length < 150) continue;
  const list = byUrl.get(c.sourceUrl) ?? [];
  list.push({ tag: c.tag, body: c.body });
  byUrl.set(c.sourceUrl, list);
}

let urls = [...byUrl.keys()];
if (LIMIT) urls = urls.slice(0, LIMIT);
console.log(`${urls.length.toLocaleString()} unique articles, ${[...byUrl.values()].reduce((n, l) => n + l.length, 0).toLocaleString()} cards`);

await mkdir("data/training", { recursive: true });
await writeFile(OUT, "");

const stats = {
  fetched: 0, dead: 0, thin: 0,
  positives: 0, negatives: 0, unmatched: 0,
};
let done = 0;
const started = Date.now();

async function processUrl(url) {
  const cards = byUrl.get(url);
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) { stats.dead++; return; }
    html = (await res.text()).slice(0, 800_000);
  } catch {
    stats.dead++;
    return;
  }
  stats.fetched++;

  const paragraphs = extractParagraphs(html);
  if (paragraphs.length < 3) { stats.thin++; return; }

  // Which paragraphs are the cards? Match by verbatim lookup rather than
  // string equality — the card body was assembled from Word runs and will
  // differ in whitespace and quote characters from the live page.
  const article = paragraphs.join("\n\n");
  const cutSpans = [];
  for (const card of cards) {
    // Try several windows, not just the opening. About one card in ten has the
    // cite fused onto the front of its body, and pages get lightly edited over
    // the years, so a probe anchored only at the start misses a lot. Short
    // enough to survive small edits, long enough to be unique.
    const b = card.body;
    const probes = [
      b.slice(0, 200),
      b.slice(Math.floor(b.length / 3), Math.floor(b.length / 3) + 200),
      b.slice(Math.max(0, Math.floor(b.length / 2) - 100), Math.floor(b.length / 2) + 100),
      b.slice(-200),
    ].filter((p) => p.trim().length >= 80);

    let hit = null;
    for (const probe of probes) {
      hit = findVerbatim(article, probe);
      if (hit) break;
    }
    if (hit) cutSpans.push({ start: hit.start, end: hit.start + b.length, tag: card.tag });
    else stats.unmatched++;
  }
  if (cutSpans.length === 0) return;

  // Tag each paragraph: overlapping a cut span is a positive, otherwise it is
  // a paragraph that was read and not taken.
  let offset = 0;
  const rows = [];
  for (const para of paragraphs) {
    const start = offset;
    const end = offset + para.length;
    offset = end + 2; // the "\n\n" join

    const overlapping = cutSpans.find((s) => start < s.end && end > s.start);
    rows.push({
      url,
      tag: overlapping ? overlapping.tag : cutSpans[0].tag,
      text: para,
      label: overlapping ? 1 : 0,
    });
  }

  stats.positives += rows.filter((r) => r.label === 1).length;
  stats.negatives += rows.filter((r) => r.label === 0).length;
  await appendFile(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// Bounded concurrency; these are other people's servers.
const queue = [...urls];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      await processUrl(url);
      done++;
      if (done % 200 === 0) {
        const mins = (Date.now() - started) / 60000;
        const eta = (urls.length - done) / (done / mins);
        console.log(
          `[${done}/${urls.length}] ok=${stats.fetched} dead=${stats.dead} ` +
          `pos=${stats.positives.toLocaleString()} neg=${stats.negatives.toLocaleString()} ` +
          `~${eta.toFixed(0)}m left`,
          );
      }
    }
  }),
);

console.log("\n--- done ---");
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(12)} ${v.toLocaleString()}`);
console.log(`\n-> ${OUT}`);

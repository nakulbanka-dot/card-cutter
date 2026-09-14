/**
 * Re-label the mined paragraphs, precisely.
 *
 * The miner marked a character range — where the card started, plus the card's
 * length — and called every paragraph overlapping it a positive. The card body
 * came out of Word and the paragraphs came out of live HTML, so those lengths
 * never line up, and the range spilled into neighbours. A legal citation
 * footnote ended up labelled as cut.
 *
 * This asks the precise question instead: does this paragraph actually appear
 * inside a card body that was cut from this article? Verbatim lookup, the same
 * check that guards the card bodies themselves. No re-fetching — the
 * paragraphs are already on disk.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { findVerbatim } from "../src/lib/verbatim.ts";

const IN = "data/training/negatives.jsonl";
const OUT = "data/training/labeled.jsonl";

// cards, by the article they came from
const cardsByUrl = new Map();
{
  const rl = createInterface({ input: createReadStream("data/cards.jsonl"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let c;
    try { c = JSON.parse(line); } catch { continue; }
    if (!c.sourceUrl || typeof c.body !== "string" || c.body.length < 150) continue;
    const list = cardsByUrl.get(c.sourceUrl) ?? [];
    list.push(c.body);
    cardsByUrl.set(c.sourceUrl, list);
  }
}

const rows = [];
let flipped = 0;
{
  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }

    const bodies = cardsByUrl.get(r.url) ?? [];
    // A paragraph is cut if a decent chunk of it sits inside a card body.
    // Probing a window rather than the whole paragraph tolerates the small
    // edits a page picks up over the years.
    const probe = r.text.slice(0, Math.min(200, r.text.length));
    const label =
      probe.trim().length >= 60 && bodies.some((b) => findVerbatim(b, probe)) ? 1 : 0;

    if (label !== r.label) flipped++;
    rows.push({ ...r, label });
  }
}

const pos = rows.filter((r) => r.label === 1).length;
await writeFile(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

console.log(`${rows.length.toLocaleString()} paragraphs re-labelled`);
console.log(`  labels changed : ${flipped.toLocaleString()}`);
console.log(`  now cut        : ${pos.toLocaleString()}`);
console.log(`  now passed over: ${(rows.length - pos).toLocaleString()}`);
console.log(`-> ${OUT}`);

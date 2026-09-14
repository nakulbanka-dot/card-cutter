/**
 * Train the passage ranker on already-cut cards.
 *
 *   node scripts/train-ranker.mjs [--max N] [--negatives K] [--event pf]
 *
 * Each card is a finished judgment call: the tag says what was wanted, the
 * body is the passage that was chosen. That gives positives for free.
 *
 * Negatives are the harder half. Random passages are useless — they are
 * off-topic, and a model that only has to tell "nuclear policy" from "bread
 * baking" learns nothing worth having. So negatives are drawn from cards that
 * SHARE a term with the tag but were cut for a different claim: topically
 * right, not what this tag asked for. That is precisely the mistake the live
 * ranker makes today, where an article arguing the opposite side ranks first
 * because it matches on keywords.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { extractFeatures, termsFromTag } from "../src/lib/ranking/features.ts";
import { train, explain } from "../src/lib/ranking/logistic.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const MAX = Number(arg("max", 120000));
const NEG_PER_POS = Number(arg("negatives", 1));
const EVENT = arg("event", "");
const IN = arg("in", "data/training/cards.jsonl");
const OUT = arg("out", "data/training/ranker.json");

console.log(`Reading ${IN} (cap ${MAX.toLocaleString()} cards)…`);

const cards = [];
const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let c;
  try { c = JSON.parse(line); } catch { continue; }
  // A 25 GB JSONL will contain the odd truncated or malformed record; a
  // missing field must skip the row, not kill a twenty-minute training run.
  if (typeof c.tag !== "string" || typeof c.body !== "string") continue;
  if (EVENT && c.event !== EVENT) continue;
  const terms = termsFromTag(c.tag);
  if (terms.length < 2 || c.body.length < 200) continue;
  cards.push({ terms, body: c.body, dupes: c.dupes, bucketId: c.bucketId, side: c.side, year: c.year });
  if (cards.length >= MAX) break;
}
console.log(`  ${cards.length.toLocaleString()} usable cards`);
if (cards.length < 100) {
  console.error("Not enough cards. Run the fetch and export scripts first.");
  process.exit(1);
}

// term -> card indices, for drawing topically-close negatives.
console.log("Indexing terms…");
const byTerm = new Map();
cards.forEach((c, i) => {
  for (const t of c.terms) {
    let list = byTerm.get(t);
    if (!list) byTerm.set(t, (list = []));
    if (list.length < 4000) list.push(i); // cap: common terms would dominate
  }
});

let rngState = 12345;
const rand = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 4294967296);

console.log("Building examples…");
const X = [];
const y = [];
let hard = 0;
let random = 0;
let opposing = 0;

for (let i = 0; i < cards.length; i++) {
  const card = cards[i];

  X.push(extractFeatures(card.terms, card.body));
  y.push(1);

  for (let k = 0; k < NEG_PER_POS; k++) {
    // Prefer a card sharing a term with this tag — a near miss, not a stranger.
    const term = card.terms[Math.floor(rand() * card.terms.length)];
    const pool = byTerm.get(term);
    let j = -1;

    if (pool && pool.length > 1) {
      // Hardest first: same topic, same season, OPPOSITE side. Those two cards
      // share vocabulary and argue against each other, so keyword overlap
      // cannot separate them and the model has to learn direction.
      for (let tries = 0; tries < 12; tries++) {
        const cand = pool[Math.floor(rand() * pool.length)];
        const other = cards[cand];
        if (cand === i || other.bucketId === card.bucketId) continue;
        if (card.side && other.side && other.side !== card.side && other.year === card.year) {
          j = cand;
          opposing++;
          break;
        }
        if (j === -1) j = cand; // keep as fallback, keep looking for opposite
      }
      if (j !== -1) hard++;
    }
    if (j === -1) {
      j = Math.floor(rand() * cards.length);
      if (j === i) continue;
      random++;
    }

    // The other card's body, scored against THIS card's tag.
    X.push(extractFeatures(card.terms, cards[j].body));
    y.push(0);
  }
}

console.log(`  ${X.length.toLocaleString()} examples  (${opposing.toLocaleString()} opposite-side, ${(hard - opposing).toLocaleString()} same-topic, ${random.toLocaleString()} random)`);

console.log("Training…");
const model = train(X, y, { epochs: 400, learningRate: 0.5, l2: 1e-4 });
const m = model.metrics;

console.log(`\n  train rows   ${m.trainRows.toLocaleString()}`);
console.log(`  test rows    ${m.testRows.toLocaleString()}`);
console.log(`  base rate    ${(m.baseRate * 100).toFixed(1)}%   <- accuracy to beat`);
console.log(`  test acc     ${(m.testAccuracy * 100).toFixed(1)}%`);
console.log(`  test AUC     ${m.testAuc.toFixed(3)}   <- 0.5 is chance`);

console.log("\nWhat the model decided matters:");
for (const { feature, weight } of explain(model)) {
  const bar = "█".repeat(Math.min(30, Math.round(Math.abs(weight) * 12)));
  console.log(`  ${feature.padEnd(20)} ${weight >= 0 ? "+" : "-"}${Math.abs(weight).toFixed(3)}  ${bar}`);
}

await mkdir("data/training", { recursive: true });
await writeFile(OUT, JSON.stringify(model, null, 2));
console.log(`\nSaved -> ${OUT}`);

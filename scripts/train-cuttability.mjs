/**
 * Train on real accept/reject decisions.
 *
 * Every row came from an article a debater actually opened: the paragraphs
 * they cut are positives, the rest of that same article are negatives. This is
 * the discrimination the openCaselist corpus could not teach, because every
 * card in it was cut.
 *
 * Split by article, not by row. Paragraphs from one piece share an outlet, a
 * subject and a house style, so letting them fall on both sides of the split
 * would let the model recognise the article instead of learning the task.
 *
 *   node scripts/train-cuttability.mjs [--max N]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile, mkdir } from "node:fs/promises";
import { extractFeatures, termsFromTag } from "../src/lib/ranking/features.ts";
import { train, explain, score } from "../src/lib/ranking/logistic.ts";

const i = process.argv.indexOf("--max");
const MAX = i !== -1 ? Number(process.argv[i + 1]) : 0;
const IN = process.argv.includes("--raw") ? "data/training/negatives.jsonl" : "data/training/labeled.jsonl";
const OUT = "data/training/cuttability.json";

const X = [];
const y = [];
const groups = [];
const kept = [];

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let r;
  try { r = JSON.parse(line); } catch { continue; }
  if (typeof r.tag !== "string" || typeof r.text !== "string") continue;

  const terms = termsFromTag(r.tag);
  if (terms.length < 2) continue;

  X.push(extractFeatures(terms, r.text));
  y.push(r.label);
  groups.push(r.url);
  kept.push(r);
  if (MAX && X.length >= MAX) break;
}

const pos = y.filter((v) => v === 1).length;
console.log(`${X.length.toLocaleString()} paragraphs from ${new Set(groups).size.toLocaleString()} articles`);
console.log(`  ${pos.toLocaleString()} cut, ${(X.length - pos).toLocaleString()} passed over\n`);

const model = train(X, y, { groups, epochs: 600, learningRate: 0.5, l2: 1e-4 });
const m = model.metrics;

// Always-predict-the-majority is the bar any classifier has to clear.
const majority = Math.max(m.baseRate, 1 - m.baseRate);

console.log(`  train rows    ${m.trainRows.toLocaleString()}  (articles held out of test)`);
console.log(`  test rows     ${m.testRows.toLocaleString()}`);
console.log(`  always-guess  ${(majority * 100).toFixed(1)}%   <- the bar`);
console.log(`  test acc      ${(m.testAccuracy * 100).toFixed(1)}%`);
console.log(`  test AUC      ${m.testAuc.toFixed(3)}   <- 0.5 is chance`);

console.log("\nWhat separates a cut paragraph from one passed over:");
for (const { feature, weight } of explain(model)) {
  const bar = "█".repeat(Math.min(28, Math.round(Math.abs(weight) * 14)));
  const dir = weight >= 0 ? "more likely cut" : "less likely cut";
  console.log(`  ${feature.padEnd(20)} ${weight >= 0 ? "+" : "-"}${Math.abs(weight).toFixed(3)}  ${bar.padEnd(28)} ${dir}`);
}

// Sanity check: the highest- and lowest-scoring real paragraphs should look
// different to a human reading them.
const scored = kept.map((r, i) => ({ r, p: score(model, X[i]) })).sort((a, b) => b.p - a.p);
console.log(`\nHighest scoring paragraph (${scored[0].p.toFixed(3)}, actually ${scored[0].r.label ? "CUT" : "passed over"}):`);
console.log(`  "${scored[0].r.text.slice(0, 180)}…"`);
const last = scored[scored.length - 1];
console.log(`\nLowest scoring (${last.p.toFixed(3)}, actually ${last.r.label ? "CUT" : "passed over"}):`);
console.log(`  "${last.r.text.slice(0, 180)}…"`);

await mkdir("data/training", { recursive: true });
await writeFile(OUT, JSON.stringify(model, null, 2));
console.log(`\nSaved -> ${OUT}`);

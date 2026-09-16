/**
 * Score the test set through the TypeScript path the app actually runs.
 *
 * Python measured P@1 0.6740 on this data. That number describes the deployed
 * product only if the TypeScript reproduces it — a different tokenizer
 * setting, a swapped text pair, or a softmax where a sigmoid belongs all
 * return plausible numbers and a worse product. The pipeline API already
 * returned exactly 1.000 for every passage here, which looked like a working
 * model right up until the scores were read.
 */
import fs from "node:fs";
import { scoreCuttable } from "../src/lib/ranking/reranker.ts";

const TITLES = JSON.parse(fs.readFileSync("data/training/titles.json", "utf8"));
const rows = fs.readFileSync("data/training/splits2/test.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const groups = new Map();
for (const r of rows) {
  const k = `${r.url} ${r.tag}`;
  if (!groups.has(k)) groups.set(k, { tag: r.tag, title: TITLES[r.url] ?? "", rows: [] });
  groups.get(k).rows.push(r);
}
const usable = [...groups.values()].filter(
  (g) => g.rows.some((r) => r.label === 1) && g.rows.some((r) => r.label === 0),
);
console.error(`${usable.length} rankable groups`);

let p1 = 0, r4 = 0, mrr = 0, done = 0, skipped = 0;
const t0 = Date.now();
for (const g of usable) {
  const scores = await scoreCuttable(
    g.tag,
    g.rows.map((r) => ({ title: g.title, text: r.text })),
  );
  if (scores.some((s) => s === null)) { skipped++; continue; }

  const order = g.rows
    .map((r, i) => ({ label: r.label, score: scores[i] }))
    .sort((a, b) => b.score - a.score);

  p1 += order[0].label === 1;
  r4 += order.slice(0, 4).some((o) => o.label === 1);
  for (let i = 0; i < order.length; i++) {
    if (order[i].label === 1) { mrr += 1 / (i + 1); break; }
  }
  if (++done % 50 === 0) {
    const rate = (Date.now() - t0) / done / 1000;
    console.error(`  ${done}/${usable.length}  ${rate.toFixed(1)}s/group  ` +
      `~${((usable.length - done) * rate / 60).toFixed(1)}m left`);
  }
}

console.log(`\nTypeScript path, ${done} groups (${skipped} skipped)`);
console.log(`  Precision@1  ${(p1 / done).toFixed(4)}   python measured 0.6740`);
console.log(`  Recall@4     ${(r4 / done).toFixed(4)}   python measured 0.8978`);
console.log(`  MRR          ${(mrr / done).toFixed(4)}   python measured 0.7773`);

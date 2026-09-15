/**
 * Score a split with the CURRENT stance model, so there is a number to beat.
 *
 * The metric is the product's own question, not a generic one: within a single
 * article, ranked against a single tag, does the paragraph a debater actually
 * cut come out on top? AUC alone would flatter any model that can tell a
 * policy article from a recipe. Precision@1 is what the user sees.
 */
import fs from "node:fs";
import readline from "node:readline";

// Production prepends the headline before the model ever sees a paragraph,
// so a baseline measured without one judges the model on an input it never
// gets. 93% of these articles still serve a title.
const TITLES = JSON.parse(fs.readFileSync("data/training/titles.json", "utf8"));
import { scoreStance } from "../src/lib/ranking/stance.ts";

const split = process.argv[2] ?? "test";
const limitGroups = Number(process.argv[3] ?? Infinity);
const path = `data/training/splits/${split}.jsonl`;

const groups = new Map();
for await (const line of readline.createInterface({ input: fs.createReadStream(path) })) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const key = `${r.url} ${r.tag}`;
  if (!groups.has(key)) groups.set(key, { tag: r.tag, title: TITLES[r.url] ?? "", rows: [] });
  groups.get(key).rows.push(r);
}

// Only groups where ranking is meaningful: something to find, something to reject.
const usable = [...groups.values()]
  .filter((g) => g.rows.some((r) => r.label === 1) && g.rows.some((r) => r.label === 0))
  .slice(0, limitGroups);

console.error(`${usable.length} rankable groups from ${path}`);

const scored = [];
let done = 0;
const t0 = Date.now();
for (const g of usable) {
  const out = [];
  for (const r of g.rows) {
    const s = await scoreStance(g.tag, r.text, g.title);
    out.push({ label: r.label, score: s ? s.support : null });
  }
  if (out.some((o) => o.score === null)) continue;
  scored.push(out);
  if (++done % 25 === 0) {
    const rate = (Date.now() - t0) / done / 1000;
    const left = ((usable.length - done) * rate) / 60;
    console.error(`  ${done}/${usable.length}  ${rate.toFixed(1)}s/group  ~${left.toFixed(1)}m left`);
  }
}

fs.writeFileSync(`data/training/baseline-titled-${split}.json`, JSON.stringify(scored));
console.error(`wrote data/training/baseline-titled-${split}.json (${scored.length} groups)`);

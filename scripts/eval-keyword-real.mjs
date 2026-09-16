/**
 * The bar, measured with the app's own ranking rather than a stand-in.
 *
 * Every comparison so far used a keyword baseline I wrote in Python: plain
 * term overlap, no stemming, no quantity or quote bonus, no prose filter. The
 * app does more than that, so if the real thing ranks better, the bar the
 * trained model has been clearing was one I set too low.
 *
 * The scoring formula below is copied from rankPassages, and the two pieces
 * that carry real logic — parseQuery and the learned prose filter — are
 * imported from the app rather than reimplemented.
 */
import fs from "node:fs";
import { parseQuery } from "../src/lib/terms.ts";
import { isProse } from "../src/lib/ranking/junk-filter.ts";

const MIN_CHARS = 180;
const MAX_CHARS = 2_400;

function isJunk(text) {
  if (/^[#>*\-|=\s\d.]+$/.test(text)) return true;
  if (/^!?\[.*\]\(.*\)$/.test(text)) return true;
  return (text.match(/\]\(/g) ?? []).length >= 3;
}

function hasQuantity(text) {
  return /\b\d{1,3}(,\d{3})*(\.\d+)?\s?(%|percent|billion|million|trillion)\b/i.test(text);
}

/** rankPassages' per-paragraph score, verbatim. */
function scoreParagraph(text, lowerTerms) {
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return 0;
  if (isJunk(text)) return 0;

  const lower = text.toLowerCase();
  const matched = lowerTerms.filter((t) => lower.includes(t));
  if (matched.length === 0) return 0;
  if (!isProse(lowerTerms, text)) return 0;

  let score = matched.length / lowerTerms.length;
  const hits = lowerTerms.reduce((n, t) => n + (lower.split(t).length - 1), 0);
  score += Math.log1p(hits) * 0.15;
  if (hasQuantity(text)) score += 0.2;
  if (/[“”]|"/.test(text)) score += 0.1;
  return score;
}

const split = process.argv[2] ?? "test";
const dir = process.argv[3] ?? "data/training/splits";
const rows = fs.readFileSync(`${dir}/${split}.jsonl`, "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const groups = new Map();
for (const r of rows) {
  const key = `${r.url} ${r.tag}`;
  if (!groups.has(key)) groups.set(key, { tag: r.tag, rows: [] });
  groups.get(key).rows.push(r);
}

const out = [];
for (const g of groups.values()) {
  if (!g.rows.some((r) => r.label === 1) || !g.rows.some((r) => r.label === 0)) continue;
  const lowerTerms = parseQuery(g.tag).terms.map((t) => t.toLowerCase());
  out.push(g.rows.map((r) => ({ label: r.label, score: scoreParagraph(r.text, lowerTerms) })));
}

fs.writeFileSync(`data/training/keyword-real-${split}2.json`, JSON.stringify(out));
console.error(`wrote data/training/keyword-real-${split}2.json (${out.length} groups)`);

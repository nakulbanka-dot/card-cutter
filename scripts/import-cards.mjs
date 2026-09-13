/**
 * Turn a folder of already-cut cards into training data.
 *
 *   npm run import-cards -- data/past-cards
 *
 * Reads .docx and .html, writes data/cards.jsonl, and prints what it found.
 * Nothing leaves the machine.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseDocx } from "../src/lib/training/parse-docx.ts";
import { parseCardsFromHtml } from "../src/lib/training/parse-html.ts";
import { underlineRatio } from "../src/lib/training/types.ts";

const dir = process.argv[2] ?? "data/past-cards";
const OUT = "data/cards.jsonl";

async function* walk(d) {
  let entries;
  try {
    entries = await readdir(d, { withFileTypes: true });
  } catch {
    console.error(`Can't read ${d}. Create it and drop your files in.`);
    process.exit(1);
  }
  for (const e of entries) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const cards = [];
const perFile = [];
let skipped = 0;

for await (const file of walk(dir)) {
  const ext = path.extname(file).toLowerCase();
  // Word leaves ~$lock files around; they aren't documents.
  if (path.basename(file).startsWith("~$")) continue;

  try {
    let found = [];
    if (ext === ".docx") {
      found = parseDocx(new Uint8Array(await readFile(file)), file);
    } else if (ext === ".html" || ext === ".htm") {
      found = parseCardsFromHtml(await readFile(file, "utf8"), file);
    } else {
      continue;
    }
    cards.push(...found);
    perFile.push({ file: path.relative(dir, file), count: found.length });
  } catch (err) {
    skipped++;
    console.warn(`  skipped ${path.relative(dir, file)}: ${err.message}`);
  }
}

await mkdir("data", { recursive: true });
await writeFile(OUT, cards.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");

// ---- what we got ----
const withUrl = cards.filter((c) => c.sourceUrl).length;
const withUnderline = cards.filter((c) => c.underlines.length > 0).length;
const ratios = cards.filter((c) => c.underlines.length).map(underlineRatio).sort((a, b) => a - b);
const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;
const tagWords = cards.map((c) => c.tag.split(/\s+/).length).sort((a, b) => a - b);

const domains = new Map();
for (const c of cards) {
  if (!c.sourceUrl) continue;
  try {
    const d = new URL(c.sourceUrl).hostname.replace(/^www\./, "");
    domains.set(d, (domains.get(d) ?? 0) + 1);
  } catch {}
}

console.log(`\nFiles read: ${perFile.length}${skipped ? `  (skipped ${skipped})` : ""}`);
console.log(`Cards parsed: ${cards.length}  ->  ${OUT}`);
console.log(`\nTraining signal:`);
console.log(`  with a source URL  : ${withUrl}/${cards.length}  <- these can produce hard negatives`);
console.log(`  with underlining   : ${withUnderline}/${cards.length}  <- these teach what gets read aloud`);
console.log(`  median underline   : ${(median * 100).toFixed(0)}% of the body`);
if (tagWords.length) {
  console.log(`  tag length (median): ${tagWords[Math.floor(tagWords.length / 2)]} words`);
}

if (domains.size) {
  console.log(`\nSources you actually cut from:`);
  for (const [d, n] of [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${d}`);
  }
}

if (cards.length === 0) {
  console.log(`\nNothing parsed. Check that ${dir} has .docx or .html files in it.`);
} else if (withUrl < cards.length * 0.4) {
  console.log(
    `\nNote: most cites have no URL, so hard negatives will be thin. The cards\n` +
      `still work as positives and for source reputation.`,
  );
}

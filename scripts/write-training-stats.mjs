/**
 * Record what the ranking has actually been built from.
 *
 * Counts are read off the data on disk, never typed in by hand — a number on
 * the homepage claiming reliability has to be one we can point at. The output
 * is committed so it ships with the repo; the underlying corpus is not.
 *
 *   node scripts/write-training-stats.mjs
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const OUT = "src/data/training-stats.json";

async function countParquetRows(dir) {
  try {
    const { stdout } = await run("python3", [
      "-c",
      `import glob,pyarrow.parquet as pq;print(sum(pq.ParquetFile(f).metadata.num_rows for f in glob.glob("${dir}/part-*.parquet")))`,
    ], { maxBuffer: 1 << 20 });
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function countLines(file) {
  try {
    await stat(file);
  } catch {
    return 0;
  }
  let n = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) n++;
  return n;
}

async function countOwnCards() {
  return countLines("data/cards.jsonl");
}

async function countFeedback() {
  const rows = await countLines("data/feedback.jsonl");
  return rows;
}

async function trainedRows() {
  try {
    const m = JSON.parse(await readFile("data/training/ranker.json", "utf8"));
    return (m.metrics?.trainRows ?? 0) + (m.metrics?.testRows ?? 0);
  } catch {
    return 0;
  }
}

async function countFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".docx")).length;
  } catch {
    return 0;
  }
}

const stats = {
  /** Cards read out of the public openCaselist corpus. */
  corpusCards: await countParquetRows("data/opencaselist/slim"),
  /** Cards parsed from local files. */
  ownCards: await countOwnCards(),
  /** Files those came from. */
  ownFiles: await countFiles("data/past-cards"),
  /** Examples the ranking model was fitted on. */
  rankerExamples: await trainedRows(),
  /** Cut / not-useful decisions recorded from real use. */
  feedbackRows: await countFeedback(),
  updated: new Date().toISOString().slice(0, 10),
};

stats.totalCards = stats.corpusCards + stats.ownCards;

await writeFile(OUT, JSON.stringify(stats, null, 2) + "\n");
console.log(`-> ${OUT}`);
for (const [k, v] of Object.entries(stats)) {
  console.log(`  ${k.padEnd(16)} ${typeof v === "number" ? v.toLocaleString() : v}`);
}

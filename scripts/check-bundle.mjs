/**
 * Can each deployed API function actually run the models — and does it carry
 * anything it cannot use?
 *
 * Run after `npm run build`. Vercel builds each function from the file list
 * Next writes beside it (route.js.nft.json), so that list is the deployment.
 * For every API route this copies exactly those files into an empty directory
 * outside the project, loads all three models from there and scores one
 * passage with each. A file the list left out fails here the way it fails in
 * production: "Cannot find module".
 *
 * Why it exists. The models are loaded by dynamic import, which the tracer
 * cannot follow, so the list is partly written by hand in next.config.ts. Twice
 * that list fell behind the dependencies — after a version bump the functions
 * shipped without onnxruntime-node, then without onnxruntime-common — and
 * production answered 200 with keyword ranking while every test passed,
 * because tests run against the full node_modules, never against the bundle.
 *
 * It also fails on what a Linux function can never use: Mac and Windows
 * builds of the runtime, the CUDA and TensorRT GPU providers, and a second
 * copy of the runtime package. Each of those has been in the bundle; together
 * they were over 400 MB of every function.
 *
 *   node scripts/check-bundle.mjs           check every API route
 *   KEEP_BUNDLE=1 node scripts/...          leave the copies in place to poke at
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const API = path.join(ROOT, ".next/server/app/api");

/** What a Linux function can never use, and why it was worth a failure. */
const FORBIDDEN = [
  [/onnxruntime-node\/bin\/napi-v6\/(darwin|win32)\//, "Mac/Windows build of the ONNX runtime"],
  [/libonnxruntime_providers_(cuda|tensorrt)/, "GPU provider (no GPU on Vercel)"],
  [/@huggingface\/transformers\/\.cache\//, "downloaded model cache"],
];

/** Packages that must be traced at most once: two copies is two runtimes. */
const SINGLE = ["onnxruntime-node", "onnxruntime-common"];

// The same loading code the app runs. These modules import nothing local and
// only types from transformers, so they work copied on their own — and the
// model package then resolves from the bundle, not from this project.
const RANKING = ["retriever", "reranker", "highlighter"];

const CHECK_MODELS = `
process.env.USE_TRAINED_MODELS = "1";
const { rankByMeaning, retrieverLoadError } = await import("./src/lib/ranking/retriever.ts");
const { scoreCuttable, rerankerLoadError } = await import("./src/lib/ranking/reranker.ts");
const { markUnderlines, highlighterLoadError } = await import("./src/lib/ranking/highlighter.ts");

const claim = "nuclear power solves climate change";
const on = "France generates roughly 70 percent of its electricity from nuclear reactors, and its grid carbon intensity sits far below the European average.";
const off = "The weather was pleasant that spring in Paris and the cafes were full of people reading.";

const out = {};
const r = await rankByMeaning(claim, [on, off]);
out.retriever = r ? { ok: r[0] > r[1], scores: r.map((n) => +n.toFixed(3)) } : { ok: false, error: retrieverLoadError() };
const k = await scoreCuttable(claim, [{ title: "", text: on }, { title: "", text: off }]);
out.reranker = k[0] !== null ? { ok: k[0] > k[1], scores: k.map((n) => +n.toFixed(3)) } : { ok: false, error: rerankerLoadError() };
const h = await markUnderlines(claim, on + " " + off);
const scored = h.filter((s) => typeof s.score === "number");
out.highlighter = scored.length === h.length && h.length > 0
  ? { ok: scored[0].score > scored[scored.length - 1].score, scores: scored.map((s) => +s.score.toFixed(3)) }
  : { ok: false, error: highlighterLoadError() };
console.log(JSON.stringify(out));
process.exit(Object.values(out).every((m) => m.ok) ? 0 : 1);
`;

function tracedFiles(route) {
  const dir = path.join(API, route);
  const { files } = JSON.parse(fs.readFileSync(path.join(dir, "route.js.nft.json"), "utf8"));
  return files
    .map((f) => path.resolve(dir, f))
    .filter((abs) => fs.existsSync(abs) && fs.statSync(abs).isFile());
}

/**
 * Every distinct node_modules/<pkg> directory a list of paths reaches into.
 *
 * onnxruntime-web keeps its own onnxruntime-common for the browser runtime;
 * that one is not a second copy of anything the Node runtime loads.
 */
function packageCopies(files, pkg) {
  const marker = `/node_modules/${pkg}/`;
  const roots = new Set();
  for (const f of files) {
    const i = f.lastIndexOf(marker);
    if (i === -1) continue;
    const root = path.relative(ROOT, f.slice(0, i + marker.length - 1));
    if (!root.includes("onnxruntime-web/")) roots.add(root);
  }
  return [...roots];
}

/**
 * Whether the route's own compiled code loads the models.
 *
 * Every API route ships the runtime (one glob covers them all, so a new route
 * cannot be forgotten), but only some call it. Asking /api/feedback to run a
 * model would fail on packages it never needs; asking /api/find not to would
 * miss the failure this check exists for.
 */
function loadsModels(files) {
  return files
    .filter((f) => f.includes("/.next/server/") && f.endsWith(".js"))
    .some((f) => fs.readFileSync(f, "utf8").includes("USE_TRAINED_MODELS"));
}

function mb(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

if (!fs.existsSync(API)) {
  console.error("No build output at .next/server/app/api — run `npm run build` first.");
  process.exit(2);
}

const routes = fs
  .readdirSync(API)
  .filter((r) => fs.existsSync(path.join(API, r, "route.js.nft.json")))
  .sort();

let failed = false;

for (const route of routes) {
  const files = tracedFiles(route);
  const size = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  const problems = [];

  for (const [pattern, why] of FORBIDDEN) {
    const hits = files.filter((f) => pattern.test(f));
    if (hits.length) {
      const bytes = hits.reduce((n, f) => n + fs.statSync(f).size, 0);
      problems.push(`${why}: ${hits.length} files, ${mb(bytes)} (e.g. ${path.relative(ROOT, hits[0])})`);
    }
  }
  for (const pkg of SINGLE) {
    const copies = packageCopies(files, pkg);
    if (copies.length > 1) problems.push(`${copies.length} copies of ${pkg}: ${copies.join(", ")}`);
  }

  let models = "does not load the models";
  if (loadsModels(files)) {
    const box = fs.mkdtempSync(path.join(os.tmpdir(), `bundle-${route}-`));
    try {
      for (const f of files) {
        const rel = path.relative(ROOT, f);
        if (rel.startsWith("..")) continue;
        fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
        fs.copyFileSync(f, path.join(box, rel));
      }
      fs.mkdirSync(path.join(box, "src/lib/ranking"), { recursive: true });
      for (const m of RANKING) {
        fs.copyFileSync(
          path.join(ROOT, `src/lib/ranking/${m}.ts`),
          path.join(box, `src/lib/ranking/${m}.ts`),
        );
      }
      fs.writeFileSync(path.join(box, "check-models.mjs"), CHECK_MODELS);

      const run = spawnSync(process.execPath, ["--no-warnings", "check-models.mjs"], {
        cwd: box,
        env: { ...process.env, NODE_PATH: "", USE_TRAINED_MODELS: "1" },
        encoding: "utf8",
        timeout: 180_000,
      });
      const line = run.stdout.trim().split("\n").pop() ?? "";
      if (run.status === 0) {
        models = `models load and rank: ${line}`;
      } else {
        models = "models do not run from the bundle";
        problems.push(`${models}: ${line || run.stderr.trim().split("\n").slice(-3).join(" | ")}`);
      }
    } finally {
      if (process.env.KEEP_BUNDLE === "1") console.log(`  (kept ${box})`);
      else fs.rmSync(box, { recursive: true, force: true });
    }
  }

  console.log(`/api/${route}  ${mb(size)}  ${problems.length ? "FAIL" : "ok"}`);
  if (!models.startsWith("models do not run")) console.log(`  ${models}`);
  for (const p of problems) console.log(`  - ${p}`);
  if (problems.length) failed = true;
}

process.exit(failed ? 1 : 0);

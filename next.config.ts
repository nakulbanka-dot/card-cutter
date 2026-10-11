import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /*
     * Pin the root to this project.
     *
     * There is an unrelated package-lock.json in the home directory, and
     * Turbopack's root inference walked up to it — which made the home folder
     * the project root and put the 38 GB corpus under data/ inside the scan.
     * The production build was killed by the OOM reaper every time.
     */
    root: path.resolve(process.cwd()),
  },

  /*
   * Keep the model files out of the build's way.
   *
   * ml/ is 68MB of ONNX binaries and tokenizer JSON sitting in the project
   * root. Nothing imports it — it is read from disk at runtime — but it is in
   * the tree the build walks, and the build began failing intermittently on
   * the CSS step with "Node.js subprocess crashed while evaluating loaders
   * [postcss]: timeout while receiving message". The same commit failed once
   * and passed on a rerun, so it is a resource edge rather than a broken
   * build, and 68MB of binaries is the thing that moved it there.
   *
   * Pinning the tracing root is the only lever here that is real. Turbopack
   * has no ignore list in this version — watchOptions takes pollIntervalMs and
   * nothing else, which typecheck caught before it shipped as a config that
   * looked like it was doing something. If the flake persists the fix is to
   * move the models out of the project tree and fetch them at build time, not
   * another option that does not exist.
   */
  outputFileTracingRoot: path.resolve(process.cwd()),
  /*
   * The models ship native ONNX binaries. They are loaded by dynamic import,
   * so they stay out of the bundle and resolve from node_modules on first use.
   */
  serverExternalPackages: ["@huggingface/transformers"],

  outputFileTracingIncludes: {
    /*
     * Every API route, not a list of them.
     *
     * ml/ is data, so nothing imports it and tracing cannot find it; the
     * native runtime is loaded by the .node binding through the dynamic
     * linker, which no static analysis sees. Both had to be named by hand —
     * and /api/underline was added after this list was written, so it shipped
     * without them and every card came back unmarked with "libonnxruntime.so.1:
     * cannot open shared object file". The route worked, nothing errored, and
     * the underlining was silently absent.
     *
     * A glob covers the next route too.
     */
    "/api/**": [
      "./ml/**",
      // The runtime, named file by file rather than package by package.
      //
      // onnxruntime-node is required dynamically by @huggingface/transformers,
      // so the tracer cannot see it and these lines are all that ship it. They
      // have been wrong twice: listing only the Linux binaries shipped them
      // with no module to load them ("Cannot find module 'onnxruntime-node'"),
      // and the next fix shipped the module without onnxruntime-common. Every
      // search answered 200 on keyword ranking while the tests passed.
      //
      // Naming whole packages fixed that and carried everything else in them:
      // the Mac and Windows builds of the runtime, 395 MB a function, plus a
      // second, unused copy of the package. Excludes do not help — they do not
      // remove files an include names, which was measured, not assumed. So the
      // includes say exactly what a Linux function loads: the package's
      // JavaScript and, for each Linux CPU type, the runtime library and the
      // binding that opens it. Both CPU types are kept; 70 MB is cheaper than
      // guessing wrong about where the function runs.
      //
      // scripts/check-bundle.mjs (run in CI) loads the models from exactly
      // these files, so a line missing here fails the build, not production.
      "./node_modules/onnxruntime-node/package.json",
      "./node_modules/onnxruntime-node/dist/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/*/libonnxruntime.so.1",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/*/onnxruntime_binding.node",
      "./node_modules/onnxruntime-common/**",
      // transformers' built code. Its src/ and types/ are not loaded at
      // runtime, and its .cache holds downloaded models — 366 MB once.
      "./node_modules/@huggingface/transformers/package.json",
      "./node_modules/@huggingface/transformers/dist/**",
    ],
  },

  // For files the tracer finds on its own. None of these are named above, and
  // an exclude cannot remove a file that an include names.
  outputFileTracingExcludes: {
    "/api/**": [
      // Downloaded model files from an earlier run — 366MB of cache that made
      // the runtime look far too big for a serverless function to hold. It is
      // rebuilt on demand and must never be traced.
      "./node_modules/@huggingface/transformers/.cache/**",
      // onnxruntime-node carries binaries for every platform it supports.
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      // The WASM runtime is for browsers; this code runs in Node.
      "./node_modules/onnxruntime-web/**",
    ],
  },
};

export default nextConfig;

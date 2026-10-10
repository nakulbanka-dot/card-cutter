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
      // The whole package, not just its binaries.
      //
      // This listed only bin/napi-v6/linux/** and relied on Next's tracer to
      // find the package's own JavaScript through @huggingface/transformers.
      // That package is marked external and requires onnxruntime-node
      // dynamically, so nothing static points at it. It worked for a while and
      // then stopped — the function shipped the native libraries with no
      // module to load them, and every search quietly fell back to keyword
      // scoring while answering 200.
      "./node_modules/onnxruntime-node/**",
    ],
  },

  outputFileTracingExcludes: {
    "/api/find": [
      // Downloaded model files from an earlier run — 366MB of cache that made
      // the runtime look far too big for a serverless function to hold. It is
      // rebuilt on demand and must never be traced.
      "./node_modules/@huggingface/transformers/.cache/**",
      // onnxruntime-node carries binaries for every platform it supports.
      // Both linux builds are kept: 18MB is cheaper than guessing wrong
      // about whether the function runs on x64 or arm64.
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      // The WASM runtime is for browsers; this code runs in Node.
      "./node_modules/onnxruntime-web/**",
    ],
  },
};

export default nextConfig;

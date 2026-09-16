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
   * The models ship native ONNX binaries. They are loaded by dynamic import,
   * so they stay out of the bundle and resolve from node_modules on first use.
   */
  serverExternalPackages: ["@huggingface/transformers"],

  outputFileTracingIncludes: {
    // The diagnostic route needs the same files as the search route.
    "/api/model-check": [
      "./ml/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/**",
    ],
    // ml/ is data, not code, so nothing imports it and tracing cannot find it.
    // Without this the function deploys without its models and every search
    // silently falls back to keyword scoring.
    "/api/find": [
      "./ml/**",
      // The native runtime, forced in by hand.
      //
      // Tracing follows JavaScript imports, and onnxruntime-node's .node
      // binding loads libonnxruntime.so.1 through the dynamic linker, which no
      // static analysis can see. The binding shipped without its shared
      // library and every model load failed with "cannot open shared object
      // file" — while the app kept answering normally on keyword scoring.
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/**",
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

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
   * The stance model ships native ONNX binaries. It is also loaded by dynamic
   * import, so it stays out of the bundle and is resolved from node_modules
   * when first used.
   */
  serverExternalPackages: ["@huggingface/transformers"],
};

export default nextConfig;

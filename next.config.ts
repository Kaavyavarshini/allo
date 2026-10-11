import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // native / heavy packages must not be bundled by webpack
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};
export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: uiRoot,
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;

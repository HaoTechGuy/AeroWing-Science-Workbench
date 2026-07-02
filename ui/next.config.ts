import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: uiRoot,
  outputFileTracingExcludes: {
    "*": [
      "C:/Users/**/Application Data/**",
      "C:/Users/**/Cookies/**",
      "C:/Users/**/Local Settings/**",
      "C:/Users/**/My Documents/**",
      "C:/Users/**/NetHood/**",
      "C:/Users/**/PrintHood/**",
      "C:/Users/**/Recent/**",
      "C:/Users/**/SendTo/**",
      "C:/Users/**/Start Menu/**",
      "C:/Users/**/Templates/**",
    ],
  },
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;

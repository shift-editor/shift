import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { capabilities: "src/capabilities.ts" },
  outDir: ".code-api",
  format: "esm",
  platform: "neutral",
  dts: {
    eager: true,
    generator: "tsc",
    tsconfig: "tsconfig.json",
  },
  sourcemap: false,
  clean: true,
  deps: {
    alwaysBundle: ["@shift/types"],
  },
});

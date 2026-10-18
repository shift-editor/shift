import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { capabilities: "src/capabilities.ts" },
  outDir: ".code-api",
  format: "esm",
  platform: "neutral",
  dts: {
    eager: true,
    generator: "tsc",
    // The bundled @shift/types and @shift/geo sources must sit under the
    // program's rootDir; with the package's own `rootDir: ./src` the
    // declaration build needed over 3 GB and ran Node out of heap.
    tsconfig: "tsconfig.code-api.json",
  },
  sourcemap: false,
  clean: true,
  deps: {
    alwaysBundle: ["@shift/types", "@shift/geo"],
  },
});

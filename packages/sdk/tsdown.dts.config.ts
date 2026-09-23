import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    clipboard: "src/clipboard.ts",
    model: "src/model.ts",
    rendering: "src/rendering.ts",
    signals: "src/signals.ts",
    text: "src/text.ts",
    tools: "src/tools.ts",
    transform: "src/transform.ts",
    types: "src/types.ts",
    variation: "src/variation.ts",
  },
  outDir: ".dts-build",
  format: "esm",
  platform: "browser",
  dts: {
    eager: true,
    generator: "tsc",
    tsconfig: "tsconfig.dts.json",
  },
  sourcemap: false,
  clean: true,
  deps: {
    alwaysBundle: [
      "@shift/editor",
      "@shift/geo",
      "@shift/glyph-state",
      "@shift/rules",
      "@shift/types",
      "@shift/validation",
      "regl",
    ],
    neverBundle: ["react", "react-dom", "react/jsx-runtime"],
  },
});

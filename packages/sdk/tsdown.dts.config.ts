import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ui: "src/ui.ts",
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
      "@shift/runtime",
      "@shift/types",
      "@shift/validation",
      "regl",
    ],
    neverBundle: [/^@base-ui-components\/react(?:\/|$)/, "react", "react-dom", "react/jsx-runtime"],
  },
});

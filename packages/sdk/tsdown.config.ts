import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const useSyncExternalStoreShim = fileURLToPath(
  new URL("./src/useSyncExternalStore.ts", import.meta.url),
);
const withSelectorShim = fileURLToPath(
  new URL("./src/useSyncExternalStoreWithSelector.ts", import.meta.url),
);

export default defineConfig({
  entry: {
    index: "src/index.ts",
    clipboard: "src/clipboard.ts",
    model: "src/model.ts",
    rendering: "src/rendering.ts",
    ui: "src/ui.ts",
    signals: "src/signals.ts",
    text: "src/text.ts",
    tools: "src/tools.ts",
    transform: "src/transform.ts",
    types: "src/types.ts",
    variation: "src/variation.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "browser",
  dts: false,
  sourcemap: true,
  clean: true,
  alias: {
    "use-sync-external-store/shim/with-selector": withSelectorShim,
    "use-sync-external-store/shim": useSyncExternalStoreShim,
  },
  deps: {
    alwaysBundle: [
      "@shift/editor",
      "@shift/geo",
      "@shift/glyph-state",
      "@shift/rules",
      "@shift/types",
      "@shift/ui",
      "@shift/validation",
      "regl",
    ],
    neverBundle: ["react", "react-dom", "react/jsx-runtime"],
  },
});

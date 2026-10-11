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
    ui: "src/ui.ts",
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
    neverBundle: [/^@base-ui\/react(?:\/|$)/, "react", "react-dom", "react/jsx-runtime"],
  },
});

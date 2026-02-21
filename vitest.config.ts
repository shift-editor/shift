import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/desktop/vitest.config.ts",
      "packages/geo/vitest.config.ts",
      "packages/validation/vitest.config.ts",
      "packages/ui/vitest.config.ts",
      "packages/glyph-info/vitest.config.ts",
      "crates/shift-node/vitest.config.ts",
    ],
  },
});

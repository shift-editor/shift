import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const distribution = process.env.SHIFT_DISTRIBUTION ?? "release";
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Invalid SHIFT_DISTRIBUTION: ${distribution}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const updateBaseUrl =
  process.env.SHIFT_UPDATE_BASE_URL ?? "https://shift-editor.github.io/shift/updates";

// https://vitejs.dev/config
export default defineConfig({
  define: {
    SHIFT_DISTRIBUTION: JSON.stringify(distribution),
    SHIFT_PRODUCT_VERSION: JSON.stringify(packageJson.version),
    SHIFT_UPDATE_BASE_URL: JSON.stringify(updateBaseUrl),
  },
  build: {
    rollupOptions: {
      external: ["shift-bridge"],
    },
  },
});

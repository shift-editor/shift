import { execFileSync } from "node:child_process";
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
let shiftBuildCommit = process.env.SHIFT_BUILD_COMMIT ?? process.env.GITHUB_SHA;
if (!shiftBuildCommit) {
  try {
    shiftBuildCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
    }).trim();
  } catch {
    shiftBuildCommit = "unknown";
  }
}

// https://vitejs.dev/config
export default defineConfig({
  define: {
    SHIFT_BUILD_COMMIT: JSON.stringify(shiftBuildCommit),
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

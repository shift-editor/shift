import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const distribution = process.env.SHIFT_DISTRIBUTION ?? "release";
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Invalid SHIFT_DISTRIBUTION: ${distribution}`);
}

const windowsUpdates = process.env.SHIFT_WINDOWS_UPDATES_ENABLED ?? "0";
if (windowsUpdates !== "0" && windowsUpdates !== "1") {
  throw new Error(`Invalid SHIFT_WINDOWS_UPDATES_ENABLED: ${windowsUpdates}`);
}
if (windowsUpdates === "1") {
  throw new Error(
    "Windows updates remain disabled until Squirrel uses an order-preserving native version",
  );
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
const updateBaseUrl =
  process.env.SHIFT_UPDATE_BASE_URL ?? "https://shift-editor.github.io/shift/updates";
const updatePublicKey = process.env.SHIFT_UPDATE_PUBLIC_KEY ?? "";

// https://vitejs.dev/config
export default defineConfig({
  define: {
    SHIFT_DISTRIBUTION: JSON.stringify(distribution),
    SHIFT_PRODUCT_VERSION: JSON.stringify(packageJson.version),
    SHIFT_UPDATE_BASE_URL: JSON.stringify(updateBaseUrl),
    SHIFT_UPDATE_PUBLIC_KEY: JSON.stringify(updatePublicKey),
    SHIFT_WINDOWS_UPDATES_ENABLED: false,
  },
  build: {
    rollupOptions: {
      external: ["shift-bridge"],
    },
  },
});

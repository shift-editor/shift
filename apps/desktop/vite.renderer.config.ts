import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import path from "path";

const distribution = process.env.SHIFT_DISTRIBUTION ?? "release";
const shiftBuildCommit = process.env.SHIFT_BUILD_COMMIT ?? process.env.GITHUB_SHA ?? "unknown";
if (distribution !== "release" && distribution !== "nightly") {
  throw new Error(`Invalid SHIFT_DISTRIBUTION: ${distribution}`);
}

// https://vitejs.dev/config
export default defineConfig(async () => {
  const [react, tailwindcss, tsconfigPaths] = await Promise.all([
    import("@vitejs/plugin-react").then((m) => m.default),
    import("@tailwindcss/vite").then((m) => m.default),
    import("vite-tsconfig-paths").then((m) => m.default),
  ]);

  return {
    root: path.resolve(__dirname, "src/renderer"),
    define: {
      SHIFT_DISTRIBUTION: JSON.stringify(distribution),
      SHIFT_BUILD_COMMIT: JSON.stringify(shiftBuildCommit),
    },
    publicDir: path.resolve(__dirname, "src/renderer/public"),
    build: {
      // Electron 44 uses Chromium 152; preserve native private fields instead of WeakMap shims.
      target: "chrome152",
      outDir: path.resolve(__dirname, ".vite/renderer/main_window"),
    },
    plugins: [
      tailwindcss(),
      react(),
      svgr({
        include: "**/*.svg",
        svgrOptions: {
          replaceAttrValues: {
            "#000": "currentColor",
            "#000000": "currentColor",
            black: "currentColor",
          },
        },
      }),
      tsconfigPaths(),
    ],
    resolve: {
      // Forge's renderer defaults preserve symlinks. Under pnpm that gives each workspace package
      // one module URL per symlink it is reached through, so shared state such as the signals
      // runtime loads twice. Resolving to real paths keeps one instance per source file.
      preserveSymlinks: false,
    },
    optimizeDeps: {
      // Serve editor workspace source directly so API changes participate in HMR instead of
      // remaining trapped in Vite's dependency cache. Its CommonJS regl dependency still needs
      // prebundling to provide the default export expected by the editor's rendering modules.
      include: [
        "regl",
        "use-sync-external-store/shim",
        "use-sync-external-store/shim/with-selector",
      ],
      exclude: [
        "@shift/editor",
        "@shift/ui",
        "@shift/geo",
        "@shift/types",
        "@shift/glyph-state",
        "@shift/glyph-info",
        "@shift/rules",
        "@shift/validation",
      ],
    },
  };
});

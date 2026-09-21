import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const forbiddenImports = new Set([
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
  "electron",
  "electron-log",
  "electron-updater",
  "shift-bridge",
  "@shift/bridge",
  "@shift/glyph-info",
]);

const forbiddenImportPrefixes = [
  "node:",
  "shift-bridge/",
  "@shift/bridge/",
  "@shift/glyph-info/",
  "@/host/",
  "@/lib/clipboard/electronSystemClipboard",
];

const forbiddenPaths = [
  "/apps/desktop/src/main/",
  "/apps/desktop/src/preload/",
  "/apps/desktop/src/utility/",
  "/apps/desktop/src/renderer/src/host/",
  "/crates/shift-bridge/",
  "/packages/glyph-info/",
];

function forbidDesktopModules(): Plugin {
  return {
    name: "forbid-desktop-modules",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (
        !forbiddenImports.has(source) &&
        !forbiddenImportPrefixes.some((prefix) => source.startsWith(prefix))
      ) {
        return null;
      }

      this.error(`Browser editor imports forbidden module ${source} from ${importer}`);
    },
    moduleParsed(module) {
      const id = module.id.replaceAll("\\", "/");
      if (!id.endsWith(".node") && !forbiddenPaths.some((fragment) => id.includes(fragment))) {
        return;
      }

      this.error(`Browser editor includes forbidden module ${id}`);
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer"),
  plugins: [forbidDesktopModules(), tsconfigPaths()],
  build: {
    emptyOutDir: true,
    minify: true,
    outDir: path.resolve(__dirname, ".vite/browser-check"),
    reportCompressedSize: true,
    lib: {
      entry: {
        runtime: path.resolve(__dirname, "../../packages/editor/src/index.ts"),
        canvas: path.resolve(__dirname, "src/renderer/src/components/editor/Canvas.tsx"),
        editor: path.resolve(__dirname, "../../packages/editor/src/lib/editor/Editor.ts"),
        font: path.resolve(__dirname, "../../packages/editor/src/lib/model/Font.ts"),
        tools: path.resolve(__dirname, "src/renderer/src/lib/tools/tools.ts"),
        context: path.resolve(__dirname, "src/renderer/src/workspace/WorkspaceContext.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});

import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import path from "path";

const packagesDir = path.resolve(__dirname, "../../packages");
const rulesSrcRoot = `${path.resolve(packagesDir, "rules", "src")}${path.sep}`;

// https://vitejs.dev/config
export default defineConfig(async () => {
  const [react, tailwindcss, tsconfigPaths] = await Promise.all([
    import("@vitejs/plugin-react").then((m) => m.default),
    import("@tailwindcss/vite").then((m) => m.default),
    import("vite-tsconfig-paths").then((m) => m.default),
  ]);

  return {
    root: path.resolve(__dirname, "src/renderer"),
    publicDir: path.resolve(__dirname, "src/renderer/public"),
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
      {
        name: "shift-rules-force-reload",
        handleHotUpdate(ctx) {
          const normalized = path.resolve(ctx.file);
          if (normalized.startsWith(rulesSrcRoot)) {
            ctx.server.ws.send({ type: "full-reload", path: "*" });
            return [];
          }
          return undefined;
        },
      },
    ],
    resolve: {
      alias: {
        "@shift/ui": path.resolve(packagesDir, "ui/src/index.ts"),
        "@shift/geo": path.resolve(packagesDir, "geo/src/index.ts"),
        "@shift/types": path.resolve(packagesDir, "types/src/index.ts"),
        "@shift/font": path.resolve(packagesDir, "font/src/index.ts"),
        "@shift/glyph-info": path.resolve(packagesDir, "glyph-info/src/index.ts"),
        "@shift/rules": path.resolve(packagesDir, "rules/src/index.ts"),
      },
    },
    optimizeDeps: {
      include: ["use-sync-external-store/shim", "use-sync-external-store/shim/with-selector"],
      exclude: [
        "@shift/ui",
        "@shift/geo",
        "@shift/types",
        "@shift/font",
        "@shift/glyph-info",
        "@shift/rules",
      ],
    },
  };
});

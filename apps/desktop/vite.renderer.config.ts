import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";
import path from "path";

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
      svgr({ include: "**/*.svg" }),
      tsconfigPaths(),
    ],
  };
});

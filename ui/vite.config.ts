import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

const host = process.env.TAURI_DEV_HOST;

// Add this plugin to log path resolution
const logResolve = () => {
  return {
    name: "vite:log-resolve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        console.log(`[Path Request] ${req.url}`);
        next();
      });
    },
    resolveId(id, importer) {
      if (id.startsWith("@")) {
        console.log(`[Resolve] ${id} from ${importer}`);
      }
      return null;
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    logResolve(),
    react(),
    tailwindcss(),
    svgr({
      include: "**/*.svg",
    }),
  ],
  root: __dirname,
  publicDir: path.resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": __dirname,
      "@/store": path.resolve(__dirname, "store"),
      "@/lib": path.resolve(__dirname, "lib"),
      "@/components": path.resolve(__dirname, "components"),
      "@/context": path.resolve(__dirname, "context"),
      "@/types": path.resolve(__dirname, "types"),
      "@/assets": path.resolve(__dirname, "assets"),
      "@/hooks": path.resolve(__dirname, "hooks"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src"),
      "@assets": path.resolve(__dirname, "src/renderer/src/assets"),
      "@components": path.resolve(__dirname, "src/renderer/src/components"),
      "@types": path.resolve(__dirname, "src/renderer/src/types"),
      "@data": path.resolve(__dirname, "src/renderer/src/charsets"),
    },
  },
});

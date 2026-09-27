import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  build: {
    emptyOutDir: false,
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { style: "src/style-loader.ts", fonts: "src/fonts-loader.ts" },
      output: {
        entryFileNames: "[name]-loader.js",
        assetFileNames: ({ names }) =>
          names.some((name) => name.endsWith(".css"))
            ? "[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});

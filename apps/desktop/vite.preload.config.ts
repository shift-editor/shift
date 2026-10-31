import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // The read-only layer reader loads the native addon; it is never bundled.
      external: ["shift-bridge"],
    },
  },
});

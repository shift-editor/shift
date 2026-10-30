// Bundles bench.ts, minified like a release renderer, for Node (ESM) and an
// Electron renderer (IIFE). "@shift/wasm" and "@shift/wasm/engine" resolve to
// the shim; "@shift/wasm/numbers" to the real NumberWriter/NumberReader.
import { build } from "esbuild";
import { resolve } from "node:path";

const here = import.meta.dirname;
const wasmSrc = resolve(here, "../../packages/wasm/src");
const shiftWasm = {
  name: "shift-wasm",
  setup(b) {
    b.onResolve({ filter: /^@shift\/wasm(\/engine)?$/ }, () => ({ path: resolve(here, "shim.ts") }));
    b.onResolve({ filter: /^@shift\/wasm\/numbers$/ }, () => ({ path: resolve(wasmSrc, "numbers.ts") }));
  },
};
const common = {
  entryPoints: [resolve(here, "entry.ts")],
  bundle: true,
  minify: true,
  target: "es2023",
  plugins: [shiftWasm],
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
};
await build({ ...common, format: "esm", platform: "node", outfile: resolve(here, "out/bench.node.mjs") });
await build({ ...common, format: "iife", platform: "browser", outfile: resolve(here, "out/bench.iife.js") });

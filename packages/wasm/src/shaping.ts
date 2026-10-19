/**
 * Text shaping, compiled from `crates/shift-wasm` with its `shaping` feature:
 * shift-shape and HarfRust, the same shaper the workspace and command line
 * use. Instantiated synchronously at import, like `@shift/wasm`.
 *
 * @remarks
 * Built into `src/generated-shaping`, a module of its own because HarfRust
 * makes it several times the size of `@shift/wasm`. Import it dynamically
 * (`await import("@shift/wasm/shaping")`) so bundlers split it into a chunk
 * that loads when text first needs shaping. Use the typed wrappers in
 * `@shift/editor`; the raw exports are for them.
 */
import { initSync } from "./generated-shaping/shift_wasm.js";
import { moduleBase64 } from "./generated-shaping/module";
import { embeddedModule } from "./embedded";

initSync({ module: embeddedModule(moduleBase64) });

export {
  registerShaper,
  releaseShaper,
  setShaperGlyphs,
  shapeParagraphs,
} from "./generated-shaping/shift_wasm.js";

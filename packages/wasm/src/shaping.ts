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
import { syncTransport } from "@shift/pack";
import {
  initSync,
  internName,
  nameOf,
  shapingRequest,
  takeReplyBlobs,
} from "./generated-shaping/shift_wasm.js";
import { moduleBase64 } from "./generated-shaping/module";
import { embeddedModule } from "./embedded";
import { Shaping } from "./generated-protocol";
import { moduleNames } from "./names";

initSync({ module: embeddedModule(moduleBase64) });

/** Text shaping with the shapers registered with `registerShaper`. */
export const shaping = new Shaping(
  syncTransport(shapingRequest, moduleNames(internName, nameOf), takeReplyBlobs),
);

export { registerShaper, releaseShaper } from "./generated-shaping/shift_wasm.js";

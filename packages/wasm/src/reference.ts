/**
 * shift-font's answers for the rules the editor keeps in TypeScript, for tests
 * that compare the two on the same inputs. Test code only.
 *
 * @remarks
 * Built from `crates/shift-wasm` with its `reference` feature into
 * `src/generated-reference`, a separate module from the one the editor runs,
 * instantiated synchronously at import like `@shift/wasm`. The app and the SDK
 * never import it, and lint rejects an import outside test files, so it never
 * ships. Each export calls the shift-font function native callers use and
 * only converts values; see `crates/shift-wasm/src/reference/`.
 */
import { initSync } from "./generated-reference/shift_wasm.js";
import { moduleBase64 } from "./generated-reference/module";
import { embeddedModule } from "./embedded";

initSync({ module: embeddedModule(moduleBase64) });

export {
  compileAxisMappings,
  composeTransform,
  contourGeometry,
  decomposeMatrix,
  mapLocation,
  resolveKerning,
  transformLayer,
  transformPoint,
} from "./generated-reference/shift_wasm.js";
// oxlint-disable-next-line eslint-js/no-restricted-syntax -- wasm-bindgen output; its types change with the Rust crate
export type * from "./generated-reference/shift_wasm.js";

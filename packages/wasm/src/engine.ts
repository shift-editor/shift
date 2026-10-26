/**
 * The editing engine, compiled from `crates/shift-wasm` with its `engine`
 * feature: shift-engine's session over shift-font, the same code the native
 * workspace runs. Instantiated synchronously at import, like `@shift/wasm`.
 *
 * @remarks
 * Built into `src/generated-engine`, a module of its own. Import it
 * dynamically (`await import("@shift/wasm/engine")`) so bundlers split it into
 * a chunk that loads when a font opens for editing. Use the typed wrapper in
 * `@shift/editor`; the raw exports are for it.
 */
import { initSync } from "./generated-engine/shift_wasm.js";
import { moduleBase64 } from "./generated-engine/module";
import { embeddedModule } from "./embedded";

initSync({ module: embeddedModule(moduleBase64) });

export {
  engineApply,
  engineBeginEdit,
  engineCancelEdit,
  engineDiscardRedo,
  engineEndEdit,
  engineMarkSaved,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRedo,
  engineRelease,
  engineUndo,
  type EngineEdit,
  type EngineLayer,
  type EngineLayerSource,
} from "./generated-engine/shift_wasm.js";

/**
 * The editing engine, compiled from `crates/shift-wasm` with its `engine`
 * feature: shift-engine's session over shift-font, the same code the native
 * workspace runs. Instantiated at import, from its own `.wasm` file rather
 * than embedded like `@shift/wasm`, so importing it waits for the compile.
 *
 * @remarks
 * Built into `src/generated-engine` as `shift_wasm_bg.wasm`, which bundlers
 * emit as an asset from the `new URL` below. Import this module
 * dynamically (`await import("@shift/wasm/engine")`) so bundlers split it into
 * a chunk that loads when a font opens for editing. Use the typed wrapper in
 * `@shift/editor`; the raw exports are for it.
 */
import { initSync } from "./generated-engine/shift_wasm.js";

/** The parts of Node's `process` this module reads, where it runs under Node. */
interface NodeProcess {
  getBuiltinModule(id: "node:fs"): { readFileSync(path: URL): Uint8Array<ArrayBuffer> };
}

/**
 * The engine's compiled module, from the file the build writes beside the
 * glue: fetched where the module is served (the app's renderer), read from
 * disk under Node (tests).
 */
async function engineModule(): Promise<WebAssembly.Module> {
  const url = new URL("./generated-engine/shift_wasm_bg.wasm", import.meta.url);
  const node = (globalThis as { process?: NodeProcess }).process;
  if (url.protocol === "file:" && node?.getBuiltinModule) {
    return new WebAssembly.Module(node.getBuiltinModule("node:fs").readFileSync(url));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the engine module did not load: ${response.status}`);
  return WebAssembly.compile(await response.arrayBuffer());
}

initSync({ module: await engineModule() });

export {
  engineApply,
  engineBeginEdit,
  engineCancelEdit,
  engineDiscardRedo,
  engineEndEdit,
  engineGlyphNumbers,
  engineKerningPairs,
  engineKerningRun,
  engineMarkSaved,
  engineNewAnchorName,
  engineNextGlyphName,
  engineOpen,
  enginePreload,
  enginePreview,
  engineRedo,
  engineRelease,
  engineRewindEdit,
  engineSourceMetricsAt,
  engineSourceNumbers,
  engineStage,
  engineUndo,
  svgPathContours,
  type EngineEdit,
  type EngineLayer,
  type EngineStructure,
  type KeptContour,
  type EngineLayerSource,
  type EngineStage,
} from "./generated-engine/shift_wasm.js";

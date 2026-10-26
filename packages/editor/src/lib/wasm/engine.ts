import type * as EngineModuleExports from "./engineModule";

/** The engine module's editor wrapper, loaded on first use. */
type EngineModule = typeof EngineModuleExports;

let loading: Promise<EngineModule> | null = null;

/**
 * Loads `@shift/wasm/engine` and its wrapper, once.
 *
 * @remarks
 * The engine module is imported dynamically, so bundlers split it into a
 * chunk of its own that loads when a font opens for editing rather than with
 * the editor.
 */
export function loadEngine(): Promise<EngineModule> {
  loading ??= import("./engineModule");
  return loading;
}

export type { EngineEdit, EngineLayer, EngineLayerSource, EngineSession } from "./engineModule";

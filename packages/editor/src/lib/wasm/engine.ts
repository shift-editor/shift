import type * as EngineModuleExports from "./engineModule";
import { signal, type Signal } from "../signals";

/** The engine module's editor wrapper, loaded on first use. */
type EngineModule = typeof EngineModuleExports;

let loading: Promise<EngineModule> | null = null;

const loadedCell = signal<EngineModule | null>(null, { name: "wasm.engineModule" });

/**
 * The engine module once {@link loadEngine} has loaded it; null until then.
 * A reader that needs it synchronously, such as text layout without an open
 * engine, reads this cell, so it runs again once the module loads.
 */
export const engineModuleCell: Signal<EngineModule | null> = loadedCell;

async function importEngine(): Promise<EngineModule> {
  const module = await import("./engineModule");
  loadedCell.set(module);
  return module;
}

/**
 * Loads `@shift/wasm/engine` and its wrapper, once.
 *
 * @remarks
 * The engine module is imported dynamically, so bundlers split it into a
 * chunk of its own that loads when a font opens for editing rather than with
 * the editor.
 */
export function loadEngine(): Promise<EngineModule> {
  loading ??= importEngine();
  return loading;
}

export type {
  EditRecording,
  EditablePair,
  EngineEdit,
  EngineKerningPair,
  EngineLayer,
  StoreRequest,
  StoreReply,
  EngineSession,
  EngineStage,
  InterpolatedMetrics,
  MissingKerningOrigin,
  SourceSetWeights,
} from "./engineModule";

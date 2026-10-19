// SPIKE: typed wrapper over the renderer-resident editing engine in
// crates/shift-wasm/src/engine.rs. One engine per module instance.
import { engineApply, engineInstallLayer, engineOpen, engineStats } from "@shift/wasm";
import type { FontIntent, GlyphState, GlyphStructure, LayerId } from "@shift/types";
import type { WorkspaceSnapshot } from "@shift/types";

/** A layer the engine changed, in the shape echoes are published in. */
export interface EngineLayer {
  structural: boolean;
  state: GlyphState;
}

interface WireLayer {
  structural: boolean;
  state: { layerId: LayerId; structure: GlyphStructure; values: number[] };
}

/** Timings the spike reports, in milliseconds. */
export const engineTimings = { open: 0, install: 0, installs: 0, apply: 0, applies: 0 };

/** Whether intents the spike routes run in the renderer engine. */
export function wasmEngineEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env?.SHIFT_WASM_ENGINE === "1") return true;
  try {
    return globalThis.localStorage?.getItem("shift.wasmEngine") === "1";
  } catch {
    return false;
  }
}

export function openEngine(workspace: WorkspaceSnapshot): void {
  const start = performance.now();
  engineOpen({ glyphs: workspace.glyphs, sources: workspace.sources });
  engineTimings.open = performance.now() - start;
}

export function installEngineLayer(state: GlyphState): void {
  const start = performance.now();
  engineInstallLayer(state.layerId, state.structure, state.values);
  engineTimings.install += performance.now() - start;
  engineTimings.installs += 1;
}

/** Applies intents in the engine; null when the engine rejects them. */
export function applyInEngine(intents: readonly FontIntent[]): EngineLayer[] | null {
  const start = performance.now();
  try {
    const layers = engineApply(intents) as WireLayer[];
    return layers.map(({ structural, state }) => ({
      structural,
      state: { ...state, values: Float64Array.from(state.values) },
    }));
  } catch {
    return null;
  } finally {
    engineTimings.apply += performance.now() - start;
    engineTimings.applies += 1;
  }
}

export function engineMemory(): { glyphs: number; wasmMemoryMb: number } {
  return engineStats() as { glyphs: number; wasmMemoryMb: number };
}

// SPIKE: lets the perf spec read the engine's timings and memory.
(globalThis as { __shiftEngine?: unknown }).__shiftEngine = {
  timings: engineTimings,
  memory: engineMemory,
};

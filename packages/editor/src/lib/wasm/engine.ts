// SPIKE: the renderer as the single writer of authored layers.
//
// Layer intents apply synchronously in the shift-font engine compiled to
// wasm (crates/shift-wasm/src/engine.rs) and publish as final state. The
// native workspace replays the same intents only to persist them; its echo
// for an engine-applied edit is checked against what the engine produced and
// never published. One engine per module instance.
import {
  engineApply,
  engineDirty,
  engineDiscardRedo,
  engineMarkSaved,
  engineInstallLayer,
  engineOpen,
  enginePersisted,
  engineRecordEdit,
  engineRedo,
  engineRollback,
  engineUndo,
  engineStats,
} from "@shift/wasm";
import type { FontIntent, GlyphState, GlyphStructure, LayerId } from "@shift/types";
import type { WorkspaceSnapshot } from "@shift/types";
import type { PendingEditId } from "../../types/editing";

interface EngineLayer {
  layerId: LayerId;
  structure?: GlyphStructure;
  values: Float64Array;
}

/** Publishes a layer state the engine produced; registered by each loaded layer. */
type EnginePublisher = (state: GlyphState) => void;

/** Counters and timings the spike reports (milliseconds). */
export const engineStatsLive = {
  open: 0,
  opens: 0,
  install: 0,
  installs: 0,
  apply: 0,
  applies: 0,
  rejected: 0,
  echoesChecked: 0,
  echoMismatches: 0,
  installFailures: 0,
  signedZeroOnly: 0,
  engineUndos: 0,
  workspaceUndos: 0,
  undo: 0,
};

// non-reactive: identities of loaded layers, read only to route engine results
const publishers = new Map<LayerId, { publish: EnginePublisher; structure: () => GlyphStructure }>();
// non-reactive: intents pushed to the workspace, consumed by the matching local edit
const pushed = new Map<PendingEditId, FontIntent[]>();
// non-reactive: what the engine produced per edit and layer, persisted and compared with the echo
const expected = new Map<PendingEditId, Map<LayerId, GlyphState>>();
// non-reactive: the intents each engine edit applied, for mismatch reports
const appliedIntents = new Map<PendingEditId, FontIntent[]>();

/** Whether layer edits apply in the renderer engine instead of TypeScript buffers. */
export function engineWriterEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env?.SHIFT_WASM_ENGINE === "writer") return true;
  try {
    return globalThis.localStorage?.getItem("shift.wasmEngine") === "writer";
  } catch {
    return false;
  }
}

export function openEngine(workspace: WorkspaceSnapshot): void {
  const start = performance.now();
  engineOpen({ glyphs: workspace.glyphs, sources: workspace.sources });
  engineStatsLive.open = performance.now() - start;
  engineStatsLive.opens += 1;
}

export function installEngineLayer(state: GlyphState): void {
  const start = performance.now();
  try {
    engineInstallLayer(state.layerId, state.structure, state.values);
  } catch {
    // The engine is not open or does not list this layer (a memory session).
    engineStatsLive.installFailures += 1;
  } finally {
    engineStatsLive.install += performance.now() - start;
    engineStatsLive.installs += 1;
  }
}

export function registerEngineLayer(
  layerId: LayerId,
  publish: EnginePublisher,
  structure: () => GlyphStructure,
): void {
  publishers.set(layerId, { publish, structure });
}

export function unregisterEngineLayer(layerId: LayerId, publish: EnginePublisher): void {
  if (publishers.get(layerId)?.publish === publish) publishers.delete(layerId);
}

/** Layer intents the renderer applies locally; Rust-only edits stay workspace-driven. */
const ROUTED_KINDS = new Set<FontIntent["kind"]>([
  "addContour",
  "addPoints",
  "setContourClosed",
  "movePoints",
  "setPointSmooth",
  "removePoints",
  "reverseContour",
  "setContourStart",
  "transformLayer",
  "setXAdvance",
  "addAnchors",
  "moveAnchors",
  "renameAnchors",
  "removeAnchors",
  "setComponentTransforms",
]);

/** Records an intent sent to the workspace so the local edit can apply the same one. */
export function recordPushedIntent(editId: PendingEditId, intent: FontIntent): void {
  if (!ROUTED_KINDS.has(intent.kind)) return;

  const intents = pushed.get(editId);
  if (intents) intents.push(intent);
  else pushed.set(editId, [intent]);
}

function takePushedIntent(editId: PendingEditId): FontIntent | null {
  const intents = pushed.get(editId);
  const intent = intents?.shift() ?? null;
  if (intents?.length === 0) pushed.delete(editId);
  return intent;
}

/**
 * Applies the intent pushed for `editId` in the engine and publishes every
 * touched layer.
 *
 * @returns `null` when no intent was pushed (a local-only session), else
 * whether the engine applied it.
 */
export function applyPushedIntent(editId: PendingEditId): boolean | null {
  const intent = takePushedIntent(editId);
  if (!intent) return null;

  const start = performance.now();
  let layers: EngineLayer[];
  try {
    layers = engineApply(editId, [intent]) as EngineLayer[];
  } catch {
    engineStatsLive.rejected += 1;
    return false;
  } finally {
    engineStatsLive.apply += performance.now() - start;
    engineStatsLive.applies += 1;
  }

  let produced = expected.get(editId);
  if (!produced) {
    produced = new Map();
    expected.set(editId, produced);
  }
  appliedIntents.set(editId, [...(appliedIntents.get(editId) ?? []), intent]);
  for (const state of publishLayers(layers)) produced.set(state.layerId, state);
  return true;
}

/** Publishes engine layers and returns their complete states, for persistence. */
function publishLayers(layers: readonly EngineLayer[]): GlyphState[] {
  const states: GlyphState[] = [];
  for (const layer of layers) {
    const target = publishers.get(layer.layerId);
    const structure = layer.structure ?? target?.structure();
    if (!structure) continue;

    const state = { layerId: layer.layerId, structure, values: layer.values };
    target?.publish(state);
    states.push(state);
  }
  return states;
}

/** The layer states an engine edit or history step produced, to persist as-is. */
export function persistStatesFor(editId: PendingEditId): GlyphState[] {
  return [...(expected.get(editId)?.values() ?? [])];
}

/** Whether the document differs from its last save, by the engine's timeline. */
export function engineDocumentDirty(): boolean {
  return engineDirty();
}

/** Marks the current timeline position as saved. */
export function markSavedInEngine(): void {
  engineMarkSaved();
}

/** Reverts an engine-applied edit whose transaction threw before reaching the workspace. */
export function rollbackInEngine(editId: PendingEditId): void {
  if (!expected.delete(editId)) return;

  publishLayers(engineRollback(editId) as EngineLayer[]);
}

/**
 * Records a committed edit in the engine's timeline.
 *
 * @returns Whether workspace entries left the redo branch, so the workspace
 * must discard its redo too.
 */
export function recordEditForUndo(editId: PendingEditId, intents: readonly FontIntent[]): boolean {
  return engineRecordEdit(editId, intents.every((intent) => ROUTED_KINDS.has(intent.kind)));
}

/** Whether every intent of an edit applied in the engine, so it persists as layer states. */
export function engineAppliedWholeEdit(
  editId: PendingEditId,
  intents: readonly FontIntent[],
): boolean {
  return expected.has(editId) && intents.every((intent) => ROUTED_KINDS.has(intent.kind));
}

/**
 * Steps the timeline synchronously.
 *
 * @param receiptId - Identity under which the step's layers persist and its echo is checked.
 * @returns `"engine"` when the engine stepped (the screen already shows it),
 * `"workspace"` when the workspace ledger must step, or `null` when nothing steps.
 */
export function stepHistoryInEngine(
  direction: "undo" | "redo",
  receiptId: PendingEditId,
): "engine" | "workspace" | null {
  const start = performance.now();
  const step = (direction === "undo" ? engineUndo() : engineRedo()) as
    | { kind: "engine"; layers: EngineLayer[] }
    | { kind: "workspace" }
    | null;
  engineStatsLive.undo += performance.now() - start;
  if (!step) return null;
  if (step.kind === "workspace") {
    engineStatsLive.workspaceUndos += 1;
    return "workspace";
  }

  engineStatsLive.engineUndos += 1;
  const states = publishLayers(step.layers);
  expected.set(receiptId, new Map(states.map((state) => [state.layerId, state])));
  return "engine";
}

/** Drops the engine's redo branch alongside the workspace's. */
export function discardRedoInEngine(): void {
  engineDiscardRedo();
}

/** Whether the engine applied `editId`, so its echo is a persistence receipt. */
export function engineOwnsEdit(editId: PendingEditId | null): boolean {
  return editId !== null && expected.has(editId);
}

/** Bit-equal, equal except for the sign of zero, or different. */
function compareValues(
  mine: Float64Array,
  theirs: Float64Array,
): "same" | "signedZero" | "different" {
  if (mine.length !== theirs.length) return "different";
  if (mine.every((value, i) => Object.is(value, theirs[i]))) return "same";
  return mine.every((value, i) => value === theirs[i]) ? "signedZero" : "different";
}

/** Compares the workspace's persisted values with what the engine produced. */
export function checkEcho(editId: PendingEditId, layerId: LayerId, values: Float64Array): void {
  const produced = expected.get(editId);
  if (!produced) return;

  engineStatsLive.echoesChecked += 1;
  const mine = produced.get(layerId)?.values;
  if (!mine) {
    engineStatsLive.echoMismatches += 1;
    return;
  }
  const comparison = compareValues(mine, values);
  if (comparison === "signedZero") {
    engineStatsLive.signedZeroOnly += 1;
    const index = mine.findIndex((value, i) => !Object.is(value, values[i]));
    mismatches.push({
      kind: "signedZero",
      intents: appliedIntents.get(editId),
      index,
      engineIsNegative: Object.is(mine[index], -0),
    });
  }
  if (comparison === "different") {
    engineStatsLive.echoMismatches += 1;
    const index = mine.findIndex((value, i) => !Object.is(value, values[i]));
    mismatches.push({
      editId,
      layerId,
      intents: appliedIntents.get(editId),
      engineLength: mine.length,
      echoLength: values.length,
      index,
      engine: Array.from(mine.slice(Math.max(0, index - 2), index + 4)),
      echo: Array.from(values.slice(Math.max(0, index - 2), index + 4)),
    });
  }
  produced.delete(layerId);
  if (produced.size > 0) return;

  expected.delete(editId);
  enginePersisted(editId);
}

export function engineMemory(): { glyphs: number; wasmMemoryMb: number } {
  return engineStats() as { glyphs: number; wasmMemoryMb: number };
}

/** Details of every echo that differed from the engine's result. */
export const mismatches: object[] = [];

// SPIKE: lets the perf spec read the engine's counters and memory.
(globalThis as { __shiftEngine?: unknown }).__shiftEngine = {
  stats: engineStatsLive,
  mismatches,
  memory: engineMemory,
};

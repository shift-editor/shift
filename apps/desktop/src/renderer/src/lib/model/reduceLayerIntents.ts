import type { FontIntent, GlyphState, LayerId } from "@shift/types";
import type { LocalLayerUpdate } from "@/types";
import { LayerPatchDraft } from "./LayerPatchDraft";
import { LayerStateDraft } from "./LayerStateDraft";

/** Returns the authored layer targeted by an editing intent. */
export function layerIdForIntent(intent: FontIntent): LayerId | null {
  switch (intent.kind) {
    case "addPoints":
      return intent.addPoints?.layerId ?? null;
    case "addContour":
      return intent.addContour?.layerId ?? null;
    case "setContourClosed":
      return intent.setContourClosed?.layerId ?? null;
    case "movePoints":
      return intent.movePoints?.layerId ?? null;
    case "setPointSmooth":
      return intent.setPointSmooth?.layerId ?? null;
    case "removePoints":
      return intent.removePoints?.layerId ?? null;
    case "addAnchors":
      return intent.addAnchors?.layerId ?? null;
    case "moveAnchors":
      return intent.moveAnchors?.layerId ?? null;
    case "removeAnchors":
      return intent.removeAnchors?.layerId ?? null;
    case "reverseContour":
      return intent.reverseContour?.layerId ?? null;
    case "translatePoints":
      return intent.translatePoints?.layerId ?? null;
    case "setXAdvance":
      return intent.setXAdvance?.layerId ?? null;
    case "applyBooleanOp":
      return intent.applyBooleanOp?.layerId ?? null;
    default:
      return null;
  }
}

/**
 * Reduces one edit's intents for a loaded layer without mutating its current state.
 *
 * Numeric-only edits return a sparse patch. Any structural edit returns one
 * complete replacement. `null` means the complete layer edit must remain
 * workspace-driven, including Rust-only boolean operations.
 */
export function reduceLayerIntents(
  intents: readonly FontIntent[],
  getState: () => GlyphState,
): LocalLayerUpdate | null {
  const state = getState();
  const targeted = intents.filter((intent) => layerIdForIntent(intent) === state.layerId);
  if (targeted.length === 0) return null;
  if (targeted.some((intent) => intent.kind === "applyBooleanOp")) return null;

  if (targeted.some(replacesLayerState)) {
    const draft = new LayerStateDraft(state);
    for (const intent of targeted) {
      if (!draft.apply(intent)) return null;
    }

    return { kind: "replace", state: draft.state };
  }

  const draft = new LayerPatchDraft(state);
  for (const intent of targeted) {
    if (!draft.apply(intent)) return null;
  }

  return {
    kind: "patch",
    positions: draft.positions,
    xAdvance: draft.xAdvance,
  };
}

function replacesLayerState(intent: FontIntent): boolean {
  switch (intent.kind) {
    case "addPoints":
    case "addContour":
    case "setContourClosed":
    case "setPointSmooth":
    case "removePoints":
    case "addAnchors":
    case "removeAnchors":
    case "reverseContour":
      return true;
    default:
      return false;
  }
}

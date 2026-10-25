import type {
  AddAnchorsIntent,
  AddComponentIntent,
  AddContourIntent,
  AddPointsIntent,
  BooleanOpIntent,
  DecomposeComponentsIntent,
  FontIntent,
  LayerId,
  MoveAnchorsIntent,
  MovePointsIntent,
  RemoveAnchorsIntent,
  RenameAnchorsIntent,
  SetComponentAlignmentIntent,
  RemoveComponentsIntent,
  RemovePointsIntent,
  ReverseContourIntent,
  SetContourClosedIntent,
  SetComponentTransformsIntent,
  SetContourStartIntent,
  SetPointSmoothIntent,
  SetXAdvanceIntent,
  TransformLayerIntent,
} from "@shift/types";
import type { PendingEditId } from "../../types/editing";

/** An intent payload minus the layer id this channel already carries. */
type Payload<TIntent> = Omit<TIntent, "layerId">;

/**
 * Builds wire intent envelopes for one glyph layer and hands each to `sink`:
 * the edit coordinator's `push` for an edit, or a list for a preview.
 */
export class LayerIntents<TResult = PendingEditId> {
  readonly #sink: (intent: FontIntent) => TResult;
  readonly #layerId: LayerId;

  constructor(sink: (intent: FontIntent) => TResult, layerId: LayerId) {
    this.#sink = sink;
    this.#layerId = layerId;
  }

  addPoints(payload: Payload<AddPointsIntent>): TResult {
    return this.#sink({
      kind: "addPoints",
      addPoints: { layerId: this.#layerId, ...payload },
    });
  }

  addContour(payload: Payload<AddContourIntent>): TResult {
    return this.#sink({
      kind: "addContour",
      addContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourClosed(payload: Payload<SetContourClosedIntent>): TResult {
    return this.#sink({
      kind: "setContourClosed",
      setContourClosed: { layerId: this.#layerId, ...payload },
    });
  }

  movePoints(payload: Payload<MovePointsIntent>): TResult {
    return this.#sink({
      kind: "movePoints",
      movePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setPointSmooth(payload: Payload<SetPointSmoothIntent>): TResult {
    return this.#sink({
      kind: "setPointSmooth",
      setPointSmooth: { layerId: this.#layerId, ...payload },
    });
  }

  removePoints(payload: Payload<RemovePointsIntent>): TResult {
    return this.#sink({
      kind: "removePoints",
      removePoints: { layerId: this.#layerId, ...payload },
    });
  }

  reverseContour(payload: Payload<ReverseContourIntent>): TResult {
    return this.#sink({
      kind: "reverseContour",
      reverseContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourStart(payload: Payload<SetContourStartIntent>): TResult {
    return this.#sink({
      kind: "setContourStart",
      setContourStart: { layerId: this.#layerId, ...payload },
    });
  }

  transformLayer(payload: Payload<TransformLayerIntent>): TResult {
    return this.#sink({
      kind: "transformLayer",
      transformLayer: { layerId: this.#layerId, ...payload },
    });
  }

  setXAdvance(payload: Payload<SetXAdvanceIntent>): TResult {
    return this.#sink({
      kind: "setXAdvance",
      setXAdvance: { layerId: this.#layerId, ...payload },
    });
  }

  applyBooleanOp(payload: Payload<BooleanOpIntent>): TResult {
    return this.#sink({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchorsIntent>): TResult {
    return this.#sink({
      kind: "addAnchors",
      addAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  moveAnchors(payload: Payload<MoveAnchorsIntent>): TResult {
    return this.#sink({
      kind: "moveAnchors",
      moveAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  removeAnchors(payload: Payload<RemoveAnchorsIntent>): TResult {
    return this.#sink({
      kind: "removeAnchors",
      removeAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  renameAnchors(payload: Payload<RenameAnchorsIntent>): TResult {
    return this.#sink({
      kind: "renameAnchors",
      renameAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentAlignment(payload: Payload<SetComponentAlignmentIntent>): TResult {
    return this.#sink({
      kind: "setComponentAlignment",
      setComponentAlignment: { layerId: this.#layerId, ...payload },
    });
  }

  addComponent(payload: Payload<AddComponentIntent>): TResult {
    return this.#sink({
      kind: "addComponent",
      addComponent: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentTransforms(payload: Payload<SetComponentTransformsIntent>): TResult {
    return this.#sink({
      kind: "setComponentTransforms",
      setComponentTransforms: { layerId: this.#layerId, ...payload },
    });
  }

  removeComponents(payload: Payload<RemoveComponentsIntent>): TResult {
    return this.#sink({
      kind: "removeComponents",
      removeComponents: { layerId: this.#layerId, ...payload },
    });
  }

  decomposeComponents(payload: Payload<DecomposeComponentsIntent>): TResult {
    return this.#sink({
      kind: "decomposeComponents",
      decomposeComponents: { layerId: this.#layerId, ...payload },
    });
  }
}

import type {
  AddAnchorsIntent,
  AddComponentIntent,
  AddContourIntent,
  AddPointsIntent,
  BooleanOpIntent,
  DecomposeComponentsIntent,
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
import type { FontIntent } from "@shift/types";
import type { PendingEditId } from "../../types/editing";
import { engineWriterEnabled, recordPushedIntent } from "../wasm/engine";
import type { FontOptions } from "../../types/font";

/** An intent payload minus the layer id this channel already carries. */
type Payload<TIntent> = Omit<TIntent, "layerId">;

/** Builds wire intent envelopes for one glyph layer. */
export class LayerIntents {
  readonly #editCoordinator: NonNullable<FontOptions["editCoordinator"]>;
  readonly #layerId: LayerId;

  constructor(editCoordinator: NonNullable<FontOptions["editCoordinator"]>, layerId: LayerId) {
    this.#editCoordinator = editCoordinator;
    this.#layerId = layerId;
  }

  /** Pushes one intent; in engine writer mode the local edit then applies this same intent. */
  #push(intent: FontIntent): PendingEditId {
    const editId = this.#editCoordinator.push(intent);
    if (engineWriterEnabled()) recordPushedIntent(editId, intent);
    return editId;
  }

  addPoints(payload: Payload<AddPointsIntent>): PendingEditId {
    return this.#push({
      kind: "addPoints",
      addPoints: { layerId: this.#layerId, ...payload },
    });
  }

  addContour(payload: Payload<AddContourIntent>): PendingEditId {
    return this.#push({
      kind: "addContour",
      addContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourClosed(payload: Payload<SetContourClosedIntent>): PendingEditId {
    return this.#push({
      kind: "setContourClosed",
      setContourClosed: { layerId: this.#layerId, ...payload },
    });
  }

  movePoints(payload: Payload<MovePointsIntent>): PendingEditId {
    return this.#push({
      kind: "movePoints",
      movePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setPointSmooth(payload: Payload<SetPointSmoothIntent>): PendingEditId {
    return this.#push({
      kind: "setPointSmooth",
      setPointSmooth: { layerId: this.#layerId, ...payload },
    });
  }

  removePoints(payload: Payload<RemovePointsIntent>): PendingEditId {
    return this.#push({
      kind: "removePoints",
      removePoints: { layerId: this.#layerId, ...payload },
    });
  }

  reverseContour(payload: Payload<ReverseContourIntent>): PendingEditId {
    return this.#push({
      kind: "reverseContour",
      reverseContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourStart(payload: Payload<SetContourStartIntent>): PendingEditId {
    return this.#push({
      kind: "setContourStart",
      setContourStart: { layerId: this.#layerId, ...payload },
    });
  }

  transformLayer(payload: Payload<TransformLayerIntent>): PendingEditId {
    return this.#push({
      kind: "transformLayer",
      transformLayer: { layerId: this.#layerId, ...payload },
    });
  }

  setXAdvance(payload: Payload<SetXAdvanceIntent>): PendingEditId {
    return this.#push({
      kind: "setXAdvance",
      setXAdvance: { layerId: this.#layerId, ...payload },
    });
  }

  applyBooleanOp(payload: Payload<BooleanOpIntent>): PendingEditId {
    return this.#push({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchorsIntent>): PendingEditId {
    return this.#push({
      kind: "addAnchors",
      addAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  moveAnchors(payload: Payload<MoveAnchorsIntent>): PendingEditId {
    return this.#push({
      kind: "moveAnchors",
      moveAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  removeAnchors(payload: Payload<RemoveAnchorsIntent>): PendingEditId {
    return this.#push({
      kind: "removeAnchors",
      removeAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  renameAnchors(payload: Payload<RenameAnchorsIntent>): PendingEditId {
    return this.#push({
      kind: "renameAnchors",
      renameAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentAlignment(payload: Payload<SetComponentAlignmentIntent>): PendingEditId {
    return this.#push({
      kind: "setComponentAlignment",
      setComponentAlignment: { layerId: this.#layerId, ...payload },
    });
  }

  addComponent(payload: Payload<AddComponentIntent>): PendingEditId {
    return this.#push({
      kind: "addComponent",
      addComponent: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentTransforms(payload: Payload<SetComponentTransformsIntent>): PendingEditId {
    return this.#push({
      kind: "setComponentTransforms",
      setComponentTransforms: { layerId: this.#layerId, ...payload },
    });
  }

  removeComponents(payload: Payload<RemoveComponentsIntent>): PendingEditId {
    return this.#push({
      kind: "removeComponents",
      removeComponents: { layerId: this.#layerId, ...payload },
    });
  }

  decomposeComponents(payload: Payload<DecomposeComponentsIntent>): PendingEditId {
    return this.#push({
      kind: "decomposeComponents",
      decomposeComponents: { layerId: this.#layerId, ...payload },
    });
  }
}

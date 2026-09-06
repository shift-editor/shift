import type {
  AddAnchorsIntent,
  AddContourIntent,
  AddPointsIntent,
  BooleanOpIntent,
  LayerId,
  MoveAnchorsIntent,
  MovePointsIntent,
  RemoveAnchorsIntent,
  RemovePointsIntent,
  ReverseContourIntent,
  SetContourClosedIntent,
  SetContourStartIntent,
  SetPointSmoothIntent,
  SetXAdvanceIntent,
  TranslatePointsIntent,
} from "@shift/types";
import type { PendingEditId } from "@/types";
import type { WorkspaceEditCoordinator } from "./WorkspaceEditCoordinator";

/** An intent payload minus the layer id this channel already carries. */
type Payload<TIntent> = Omit<TIntent, "layerId">;

/** Builds wire intent envelopes for one glyph layer. */
export class LayerIntents {
  readonly #editCoordinator: WorkspaceEditCoordinator;
  readonly #layerId: LayerId;

  constructor(editCoordinator: WorkspaceEditCoordinator, layerId: LayerId) {
    this.#editCoordinator = editCoordinator;
    this.#layerId = layerId;
  }

  addPoints(payload: Payload<AddPointsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "addPoints",
      addPoints: { layerId: this.#layerId, ...payload },
    });
  }

  addContour(payload: Payload<AddContourIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "addContour",
      addContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourClosed(payload: Payload<SetContourClosedIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "setContourClosed",
      setContourClosed: { layerId: this.#layerId, ...payload },
    });
  }

  movePoints(payload: Payload<MovePointsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "movePoints",
      movePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setPointSmooth(payload: Payload<SetPointSmoothIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "setPointSmooth",
      setPointSmooth: { layerId: this.#layerId, ...payload },
    });
  }

  removePoints(payload: Payload<RemovePointsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "removePoints",
      removePoints: { layerId: this.#layerId, ...payload },
    });
  }

  reverseContour(payload: Payload<ReverseContourIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "reverseContour",
      reverseContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourStart(payload: Payload<SetContourStartIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "setContourStart",
      setContourStart: { layerId: this.#layerId, ...payload },
    });
  }

  translatePoints(payload: Payload<TranslatePointsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "translatePoints",
      translatePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setXAdvance(payload: Payload<SetXAdvanceIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "setXAdvance",
      setXAdvance: { layerId: this.#layerId, ...payload },
    });
  }

  applyBooleanOp(payload: Payload<BooleanOpIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchorsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "addAnchors",
      addAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  moveAnchors(payload: Payload<MoveAnchorsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "moveAnchors",
      moveAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  removeAnchors(payload: Payload<RemoveAnchorsIntent>): PendingEditId {
    return this.#editCoordinator.push({
      kind: "removeAnchors",
      removeAnchors: { layerId: this.#layerId, ...payload },
    });
  }
}

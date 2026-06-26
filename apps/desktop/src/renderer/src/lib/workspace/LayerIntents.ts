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
  SetPointSmoothIntent,
  SetXAdvanceIntent,
  TranslatePointsIntent,
} from "@shift/types";
import type { WorkspaceEditCoordinator } from "./WorkspaceEditCoordinator";

/** An intent payload minus the layer id this channel already carries. */
type Payload<TIntent> = Omit<TIntent, "layerId">;

/**
 * RPC-shaped intent calls for one glyph layer.
 *
 * @remarks
 * This is the ONLY place wire envelopes (`{ kind, <payload> }`) are built;
 * everything above it speaks typed calls. Each call enters the edit queue's
 * coalescing window, so calls in the same tick become one apply and one
 * undo step. No display strings ride the calls; undo labels are a concern
 * for the ledger, not the renderer.
 */
export class LayerIntents {
  readonly #editCoordinator: WorkspaceEditCoordinator;
  readonly #layerId: LayerId;

  constructor(editCoordinator: WorkspaceEditCoordinator, layerId: LayerId) {
    this.#editCoordinator = editCoordinator;
    this.#layerId = layerId;
  }

  addPoints(payload: Payload<AddPointsIntent>): void {
    this.#editCoordinator.push({
      kind: "addPoints",
      addPoints: { layerId: this.#layerId, ...payload },
    });
  }

  addContour(payload: Payload<AddContourIntent>): void {
    this.#editCoordinator.push({
      kind: "addContour",
      addContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourClosed(payload: Payload<SetContourClosedIntent>): void {
    this.#editCoordinator.push({
      kind: "setContourClosed",
      setContourClosed: { layerId: this.#layerId, ...payload },
    });
  }

  movePoints(payload: Payload<MovePointsIntent>): void {
    this.#editCoordinator.push({
      kind: "movePoints",
      movePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setPointSmooth(payload: Payload<SetPointSmoothIntent>): void {
    this.#editCoordinator.push({
      kind: "setPointSmooth",
      setPointSmooth: { layerId: this.#layerId, ...payload },
    });
  }

  removePoints(payload: Payload<RemovePointsIntent>): void {
    this.#editCoordinator.push({
      kind: "removePoints",
      removePoints: { layerId: this.#layerId, ...payload },
    });
  }

  reverseContour(payload: Payload<ReverseContourIntent>): void {
    this.#editCoordinator.push({
      kind: "reverseContour",
      reverseContour: { layerId: this.#layerId, ...payload },
    });
  }

  translatePoints(payload: Payload<TranslatePointsIntent>): void {
    this.#editCoordinator.push({
      kind: "translatePoints",
      translatePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setXAdvance(payload: Payload<SetXAdvanceIntent>): void {
    this.#editCoordinator.push({
      kind: "setXAdvance",
      setXAdvance: { layerId: this.#layerId, ...payload },
    });
  }

  applyBooleanOp(payload: Payload<BooleanOpIntent>): void {
    this.#editCoordinator.push({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchorsIntent>): void {
    this.#editCoordinator.push({
      kind: "addAnchors",
      addAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  moveAnchors(payload: Payload<MoveAnchorsIntent>): void {
    this.#editCoordinator.push({
      kind: "moveAnchors",
      moveAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  removeAnchors(payload: Payload<RemoveAnchorsIntent>): void {
    this.#editCoordinator.push({
      kind: "removeAnchors",
      removeAnchors: { layerId: this.#layerId, ...payload },
    });
  }
}

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
import type { PendingEditApplication } from "@/types";
import type { WorkspaceEditCoordinator } from "./WorkspaceEditCoordinator";

/** An intent payload minus the layer id this channel already carries. */
type Payload<TIntent> = Omit<TIntent, "layerId">;

/**
 * RPC-shaped intent calls for one glyph layer.
 *
 * @remarks
 * This is the ONLY place wire envelopes (`{ kind, <payload> }`) are built;
 * everything above it speaks typed calls. Locally representable operations
 * carry an application supplied by the typed glyph-editing surface; this class
 * forwards it without interpreting the envelope. Each call is one workspace
 * operation unless the caller has opened a workspace transaction. No display
 * strings ride the calls; undo labels are a concern for the ledger, not the renderer.
 */
export class LayerIntents {
  readonly #editCoordinator: WorkspaceEditCoordinator;
  readonly #layerId: LayerId;

  constructor(editCoordinator: WorkspaceEditCoordinator, layerId: LayerId) {
    this.#editCoordinator = editCoordinator;
    this.#layerId = layerId;
  }

  addPoints(payload: Payload<AddPointsIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "addPoints",
        addPoints: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  addContour(payload: Payload<AddContourIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "addContour",
        addContour: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  setContourClosed(
    payload: Payload<SetContourClosedIntent>,
    applyLocally?: PendingEditApplication,
  ): void {
    this.#editCoordinator.push(
      {
        kind: "setContourClosed",
        setContourClosed: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  movePoints(payload: Payload<MovePointsIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "movePoints",
        movePoints: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  setPointSmooth(
    payload: Payload<SetPointSmoothIntent>,
    applyLocally?: PendingEditApplication,
  ): void {
    this.#editCoordinator.push(
      {
        kind: "setPointSmooth",
        setPointSmooth: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  removePoints(payload: Payload<RemovePointsIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "removePoints",
        removePoints: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  reverseContour(
    payload: Payload<ReverseContourIntent>,
    applyLocally?: PendingEditApplication,
  ): void {
    this.#editCoordinator.push(
      {
        kind: "reverseContour",
        reverseContour: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  translatePoints(
    payload: Payload<TranslatePointsIntent>,
    applyLocally?: PendingEditApplication,
  ): void {
    this.#editCoordinator.push(
      {
        kind: "translatePoints",
        translatePoints: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  setXAdvance(payload: Payload<SetXAdvanceIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "setXAdvance",
        setXAdvance: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  applyBooleanOp(payload: Payload<BooleanOpIntent>): void {
    this.#editCoordinator.push({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchorsIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "addAnchors",
        addAnchors: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  moveAnchors(payload: Payload<MoveAnchorsIntent>, applyLocally?: PendingEditApplication): void {
    this.#editCoordinator.push(
      {
        kind: "moveAnchors",
        moveAnchors: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }

  removeAnchors(
    payload: Payload<RemoveAnchorsIntent>,
    applyLocally?: PendingEditApplication,
  ): void {
    this.#editCoordinator.push(
      {
        kind: "removeAnchors",
        removeAnchors: { layerId: this.#layerId, ...payload },
      },
      applyLocally,
    );
  }
}

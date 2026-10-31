import type {
  AddAnchors,
  AddComponent,
  AddContour,
  AddPoints,
  ApplyBooleanOp,
  DecomposeComponents,
  FontIntent,
  LayerId,
  MoveAnchors,
  MovePoints,
  RemoveAnchors,
  RenameAnchors,
  SetComponentAlignment,
  RemoveComponents,
  RemovePoints,
  ReverseContour,
  SplitSegment,
  UpgradeLineToCubic,
  DeletePoints,
  JoinContours,
  TransformPoints,
  AlignPoints,
  DistributePoints,
  ShiftSidebearing,
  SetContourClosed,
  SetComponentTransforms,
  SetContourStart,
  SetPointSmooth,
  SetPositions,
  SetXAdvance,
  TransformLayer,
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

  addPoints(payload: Payload<AddPoints>): TResult {
    return this.#sink({
      kind: "addPoints",
      addPoints: { layerId: this.#layerId, ...payload },
    });
  }

  /** Every point and anchor position at once, naming none: see {@link SetPositions}. */
  setPositions(payload: Payload<SetPositions>): TResult {
    return this.#sink({
      kind: "setPositions",
      setPositions: { layerId: this.#layerId, ...payload },
    });
  }

  addContour(payload: Payload<AddContour>): TResult {
    return this.#sink({
      kind: "addContour",
      addContour: { layerId: this.#layerId, ...payload },
    });
  }

  setContourClosed(payload: Payload<SetContourClosed>): TResult {
    return this.#sink({
      kind: "setContourClosed",
      setContourClosed: { layerId: this.#layerId, ...payload },
    });
  }

  movePoints(payload: Payload<MovePoints>): TResult {
    return this.#sink({
      kind: "movePoints",
      movePoints: { layerId: this.#layerId, ...payload },
    });
  }

  setPointSmooth(payload: Payload<SetPointSmooth>): TResult {
    return this.#sink({
      kind: "setPointSmooth",
      setPointSmooth: { layerId: this.#layerId, ...payload },
    });
  }

  removePoints(payload: Payload<RemovePoints>): TResult {
    return this.#sink({
      kind: "removePoints",
      removePoints: { layerId: this.#layerId, ...payload },
    });
  }

  reverseContour(payload: Payload<ReverseContour>): TResult {
    return this.#sink({
      kind: "reverseContour",
      reverseContour: { layerId: this.#layerId, ...payload },
    });
  }

  deletePoints(payload: Payload<DeletePoints>): TResult {
    return this.#sink({
      kind: "deletePoints",
      deletePoints: { layerId: this.#layerId, ...payload },
    });
  }

  splitSegment(payload: Payload<SplitSegment>): TResult {
    return this.#sink({
      kind: "splitSegment",
      splitSegment: { layerId: this.#layerId, ...payload },
    });
  }

  upgradeLineToCubic(payload: Payload<UpgradeLineToCubic>): TResult {
    return this.#sink({
      kind: "upgradeLineToCubic",
      upgradeLineToCubic: { layerId: this.#layerId, ...payload },
    });
  }

  joinContours(payload: Payload<JoinContours>): TResult {
    return this.#sink({
      kind: "joinContours",
      joinContours: { layerId: this.#layerId, ...payload },
    });
  }

  transformPoints(payload: Payload<TransformPoints>): TResult {
    return this.#sink({
      kind: "transformPoints",
      transformPoints: { layerId: this.#layerId, ...payload },
    });
  }

  alignPoints(payload: Payload<AlignPoints>): TResult {
    return this.#sink({
      kind: "alignPoints",
      alignPoints: { layerId: this.#layerId, ...payload },
    });
  }

  distributePoints(payload: Payload<DistributePoints>): TResult {
    return this.#sink({
      kind: "distributePoints",
      distributePoints: { layerId: this.#layerId, ...payload },
    });
  }

  shiftSidebearing(payload: Payload<ShiftSidebearing>): TResult {
    return this.#sink({
      kind: "shiftSidebearing",
      shiftSidebearing: { layerId: this.#layerId, ...payload },
    });
  }

  setContourStart(payload: Payload<SetContourStart>): TResult {
    return this.#sink({
      kind: "setContourStart",
      setContourStart: { layerId: this.#layerId, ...payload },
    });
  }

  transformLayer(payload: Payload<TransformLayer>): TResult {
    return this.#sink({
      kind: "transformLayer",
      transformLayer: { layerId: this.#layerId, ...payload },
    });
  }

  setXAdvance(payload: Payload<SetXAdvance>): TResult {
    return this.#sink({
      kind: "setXAdvance",
      setXAdvance: { layerId: this.#layerId, ...payload },
    });
  }

  applyBooleanOp(payload: Payload<ApplyBooleanOp>): TResult {
    return this.#sink({
      kind: "applyBooleanOp",
      applyBooleanOp: { layerId: this.#layerId, ...payload },
    });
  }

  addAnchors(payload: Payload<AddAnchors>): TResult {
    return this.#sink({
      kind: "addAnchors",
      addAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  moveAnchors(payload: Payload<MoveAnchors>): TResult {
    return this.#sink({
      kind: "moveAnchors",
      moveAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  removeAnchors(payload: Payload<RemoveAnchors>): TResult {
    return this.#sink({
      kind: "removeAnchors",
      removeAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  renameAnchors(payload: Payload<RenameAnchors>): TResult {
    return this.#sink({
      kind: "renameAnchors",
      renameAnchors: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentAlignment(payload: Payload<SetComponentAlignment>): TResult {
    return this.#sink({
      kind: "setComponentAlignment",
      setComponentAlignment: { layerId: this.#layerId, ...payload },
    });
  }

  addComponent(payload: Payload<AddComponent>): TResult {
    return this.#sink({
      kind: "addComponent",
      addComponent: { layerId: this.#layerId, ...payload },
    });
  }

  setComponentTransforms(payload: Payload<SetComponentTransforms>): TResult {
    return this.#sink({
      kind: "setComponentTransforms",
      setComponentTransforms: { layerId: this.#layerId, ...payload },
    });
  }

  removeComponents(payload: Payload<RemoveComponents>): TResult {
    return this.#sink({
      kind: "removeComponents",
      removeComponents: { layerId: this.#layerId, ...payload },
    });
  }

  decomposeComponents(payload: Payload<DecomposeComponents>): TResult {
    return this.#sink({
      kind: "decomposeComponents",
      decomposeComponents: { layerId: this.#layerId, ...payload },
    });
  }
}

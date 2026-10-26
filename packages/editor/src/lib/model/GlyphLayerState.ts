import type {
  ContourData,
  ContourId,
  GlyphState,
  GlyphStructure,
  LayerId,
  PointId,
} from "@shift/types";
import {
  GlyphGeometry,
  type GlyphPosition,
  type GlyphPositionTarget,
  type GlyphPositions,
  type GlyphSidebearings,
} from "@shift/glyph-state";
import type { Bounds } from "@shift/geo";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "../signals/signal";
import { LayerBuffers, type LayerChangeToken } from "./LayerBuffers";

/** A contour an edit kept as it was: the one with this id in the structure it started from. */
export interface KeptContour {
  readonly id: ContourId;
  readonly kept: true;
}

/** A layer's structure after an edit; the contours it kept may come by id alone. */
export interface EditedStructure extends Omit<GlyphStructure, "contours"> {
  readonly contours: readonly (ContourData | KeptContour)[];
}

/**
 * A layer as an edit left it: its values, and its structure unless the edit
 * kept it.
 */
export interface LayerUpdate {
  readonly layerId: LayerId;
  /**
   * The layer's structure, or null when the edit changed only values. Either
   * way it is read against the structure the edit started from (the active
   * drag's base, else the one shown): null keeps it whole, and a kept contour
   * is the one with its id there.
   */
  readonly structure: EditedStructure | null;
  readonly values: Float64Array;
}

/**
 * Reactive state for one authored layer, as the window's editing engine last
 * left it.
 *
 * Edits apply in shift-font, through the engine, and arrive here whole through
 * {@link GlyphLayerState.replace}; this class applies no edit itself. A drag
 * previews positions with {@link GlyphLayerState.patchPositions} between
 * {@link GlyphLayerState.beginEdit} and its finish or cancel.
 */
export class GlyphLayerState {
  readonly #layerId: LayerId;
  readonly #buffers: WritableSignal<LayerBuffers>;
  readonly #structure: ComputedSignal<GlyphStructure>;
  readonly #xAdvance: ComputedSignal<number>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;
  readonly #buffersChanged: ComputedSignal<LayerChangeToken>;
  readonly #geometry: ComputedSignal<GlyphGeometry>;
  readonly #acceptedGeometry: ComputedSignal<GlyphGeometry | null>;

  readonly #editBaseState: WritableSignal<GlyphState | null> = signal<GlyphState | null>(null, {
    name: "glyphLayer.editBase",
  });
  #reapplyEdit: (() => void) | null = null;

  constructor(state: GlyphState) {
    this.#layerId = state.layerId;
    this.#buffers = signal(LayerBuffers.fromState(state), {
      name: "glyphLayer.buffers",
    });
    this.#structure = computed(() => this.#buffers.value.structureCell.value, {
      name: "glyphLayer.structure",
    });
    this.#xAdvance = computed(() => this.#buffers.value.xAdvanceCell.value, {
      name: "glyphLayer.xAdvance",
    });
    this.#sidebearings = computed(() => this.#buffers.value.sidebearingsCell.value, {
      name: "glyphLayer.sidebearings",
    });
    this.#buffersChanged = computed(() => this.#buffers.value.changedCell.value, {
      name: "glyphLayer.buffers.changed",
    });
    this.#geometry = computed(
      () => new GlyphGeometry(this.#structure.value, this.#buffers.value.snapshotCell.value),
      { name: "glyphLayer.geometry" },
    );
    this.#acceptedGeometry = computed(
      () => {
        const accepted = this.#editBaseState.value;
        return accepted ? new GlyphGeometry(accepted.structure, accepted.values) : null;
      },
      { name: "glyphLayer.acceptedGeometry" },
    );
  }

  get structure(): GlyphStructure {
    return this.#structure.peek();
  }

  get structureCell(): Signal<GlyphStructure> {
    return this.#structure;
  }

  get layerId(): LayerId {
    return this.#layerId;
  }

  get buffers(): LayerBuffers {
    return this.#buffers.peek();
  }

  get buffersCell(): Signal<LayerBuffers> {
    return this.#buffers;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#xAdvance;
  }

  get xAdvance(): number {
    return this.#xAdvance.peek();
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#sidebearings;
  }

  /** Invalidates on numeric buffer changes without packing a full glyph snapshot. */
  get buffersChangedCell(): Signal<LayerChangeToken> {
    return this.#buffersChanged;
  }

  get bounds(): Bounds | null {
    return this.#buffers.peek().bounds;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#sidebearings.peek();
  }

  get pointCount(): number {
    let count = 0;
    for (const contour of this.#buffers.peek().contours) count += contour.pointCount;
    return count;
  }

  get geometry(): GlyphGeometry {
    return this.#geometry.peek();
  }

  get geometryCell(): Signal<GlyphGeometry> {
    return this.#geometry;
  }

  /**
   * The layer as it stood when the active drag began; null outside a drag.
   *
   * @remarks
   * Lets other glyphs decide what was true before an edit in progress, such
   * as which of their components sat on this layer's anchors.
   */
  get acceptedGeometryCell(): Signal<GlyphGeometry | null> {
    return this.#acceptedGeometry;
  }

  /**
   * The accepted layer state the active local edit started from.
   *
   * @remarks
   * `null` outside a local edit. When a workspace echo lands mid-edit the base
   * moves to the newly accepted state before the edit is replayed on top.
   */
  get editBaseCell(): Signal<GlyphState | null> {
    return this.#editBaseState;
  }

  get state(): GlyphState {
    const buffers = this.#buffers.peek();
    return {
      layerId: this.#layerId,
      structure: buffers.structure,
      values: buffers.snapshot,
    };
  }

  /** How many positions the layer holds: every contour point and every anchor. */
  get positionCount(): number {
    return this.#buffers.peek().positionCount;
  }

  /** The layer's positions in `setPositions` order with `updates` applied. */
  positionsWith(updates: GlyphPositions): number[] {
    return this.#buffers.peek().positionsWith(updates);
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    return this.#buffers.peek().positionsFor(targets);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#buffers.peek().contourIdOfPoint(pointId);
  }

  /** Shows `update`, as the window's engine or the workspace's echo left the layer. */
  replace(update: LayerUpdate): void {
    this.#publish(update);
  }

  replaceValues(values: Float64Array): void {
    this.replace({ layerId: this.#layerId, structure: null, values });
  }

  patchPositions(updates: GlyphPositions): void {
    this.#buffers.peek().patchPositions(updates);
  }

  /** Begins a drag previewed by position patches; `reapply` repeats it on a new base. */
  beginEdit(reapply: () => void): void {
    if (this.#editBaseState.peek()) throw new Error("glyph layer already has an active edit");

    this.#editBaseState.set(this.state);
    this.#reapplyEdit = reapply;
  }

  /** Restores the base the drag began from, then commits the edit through `apply`. */
  finishEdit(apply: () => void): void {
    const baseState = this.#editBaseState.peek();
    if (!baseState) throw new Error("glyph layer has no active edit to finish");

    this.#reapplyEdit = null;

    batch(() => {
      this.#editBaseState.set(null);
      this.#publish(baseState);
      apply();
    });
  }

  /** Cancels the active edit and restores the latest accepted layer state. */
  cancelEdit(): void {
    const baseState = this.#editBaseState.peek();
    if (!baseState) return;

    this.#reapplyEdit = null;
    batch(() => {
      this.#editBaseState.set(null);
      this.#publish(baseState);
    });
  }

  /**
   * Shows the layer as a gesture under way would leave it, keeping the base
   * the gesture began from; null shows that base again.
   */
  showPreview(state: LayerUpdate | null): void {
    const shown = state ?? this.#editBaseState.peek();
    if (!shown) throw new Error("glyph layer has no active edit to preview");
    this.#show(shown);
  }

  #publish(state: LayerUpdate): void {
    batch(() => {
      this.#show(state);
      if (!this.#reapplyEdit) return;

      this.#editBaseState.set(this.state);
      this.#reapplyEdit();
    });
  }

  #show(update: LayerUpdate): void {
    batch(() => {
      const buffers = this.#buffers.peek();
      const base = this.#editBaseState.peek()?.structure ?? buffers.structure;
      const structure = update.structure ? withKeptContours(update.structure, base) : base;
      if (
        structure === buffers.structure ||
        GlyphGeometry.structuresEqual(buffers.structure, structure)
      ) {
        const values = buffers.snapshot;
        if (
          values.length !== update.values.length ||
          !values.every((value, index) => Object.is(value, update.values[index]))
        ) {
          buffers.replaceValues(update.values);
        }
      } else {
        this.#buffers.set(
          LayerBuffers.fromState(
            { layerId: this.#layerId, structure, values: update.values },
            buffers,
          ),
        );
      }
    });
  }
}

/**
 * `edited` with each kept contour replaced by the contour with its id in
 * `base`, the same object, so buffers built for it can be reused.
 *
 * @throws When `base` has no contour a kept one names: the engine and this
 * window disagree about the layer.
 */
function withKeptContours(edited: EditedStructure, base: GlyphStructure): GlyphStructure {
  if (isWhole(edited)) return edited;

  const byId = new Map(base.contours.map((contour) => [contour.id, contour]));
  return {
    ...edited,
    contours: edited.contours.map((contour) => {
      if (!isKept(contour)) return contour;
      const kept = byId.get(contour.id);
      if (!kept) throw new Error(`an edit kept contour ${contour.id}, which this layer lacks`);
      return kept;
    }),
  };
}

function isWhole(structure: EditedStructure): structure is GlyphStructure {
  return !structure.contours.some(isKept);
}

function isKept(contour: ContourData | KeptContour): contour is KeptContour {
  return "kept" in contour;
}

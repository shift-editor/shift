import type {
  AnchorId,
  AnchorSeed,
  ContourId,
  GlyphState,
  GlyphStructure,
  LayerId,
  LayerReplaced,
  PointId,
  PointSeed,
} from "@shift/types";
import {
  GlyphGeometry,
  type GlyphPosition,
  type GlyphPositionTarget,
  type GlyphPositions,
  type GlyphSidebearings,
} from "@shift/glyph-state";
import type { Bounds } from "@shift/geo";
import type { PendingEditId } from "@/types";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";
import { LayerBuffers } from "./LayerBuffers";

/**
 * Reactive state and pending-confirmation lifecycle for one authored layer.
 *
 * Local operation semantics belong to {@link LayerBuffers}; this class only
 * wraps successful operations in the pending lifecycle and folds authoritative
 * workspace replacements. Rust remains the sole `FontIntent` interpreter.
 */
export class GlyphLayerState {
  readonly #layerId: LayerId;
  readonly #buffers: WritableSignal<LayerBuffers>;
  readonly #structure: ComputedSignal<GlyphStructure>;
  readonly #xAdvance: ComputedSignal<number>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;
  readonly #buffersChanged: ComputedSignal<LayerBuffers>;
  readonly #geometry: ComputedSignal<GlyphGeometry>;

  #confirmedState: GlyphState | null = null;
  readonly #pendingStates = new Map<PendingEditId, GlyphState>();

  #editBaseState: GlyphState | null = null;
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
    this.#buffersChanged = computed(
      () => {
        const buffers = this.#buffers.value;
        buffers.changedCell.value;
        return buffers;
      },
      { name: "glyphLayer.buffers.changed" },
    );
    this.#geometry = computed(
      () => new GlyphGeometry(this.#structure.value, this.#buffers.value.snapshotCell.value),
      { name: "glyphLayer.geometry" },
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
  get buffersChangedCell(): Signal<LayerBuffers> {
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

  get state(): GlyphState {
    const buffers = this.#buffers.peek();
    return {
      layerId: this.#layerId,
      structure: buffers.structure,
      values: buffers.snapshot,
    };
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    return this.#buffers.peek().positionsFor(targets);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#buffers.peek().contourIdOfPoint(pointId);
  }

  addContour(editId: PendingEditId, contourId: ContourId, closed: boolean): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().addContour(contourId, closed));
  }

  addPoints(
    editId: PendingEditId,
    points: readonly PointSeed[],
    contourId?: ContourId,
    before?: PointId,
  ): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().addPoints(points, contourId, before));
  }

  setContourClosed(editId: PendingEditId, contourId: ContourId, closed: boolean): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().setContourClosed(contourId, closed));
  }

  movePoints(
    editId: PendingEditId,
    pointIds: readonly PointId[],
    coords: readonly number[],
  ): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().movePoints(pointIds, coords));
  }

  setPointSmooth(editId: PendingEditId, pointId: PointId, smooth: boolean): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().setPointSmooth(pointId, smooth));
  }

  removePoints(editId: PendingEditId, pointIds: readonly PointId[]): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().removePoints(pointIds));
  }

  reverseContour(editId: PendingEditId, contourId: ContourId): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().reverseContour(contourId));
  }

  translatePoints(
    editId: PendingEditId,
    pointIds: readonly PointId[],
    dx: number,
    dy: number,
  ): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().translatePoints(pointIds, dx, dy));
  }

  setXAdvance(editId: PendingEditId, width: number): void {
    this.#applyEdit(editId, () => this.#buffers.peek().setXAdvance(width));
  }

  addAnchors(editId: PendingEditId, anchors: readonly AnchorSeed[]): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().addAnchors(anchors));
  }

  moveAnchors(
    editId: PendingEditId,
    anchorIds: readonly AnchorId[],
    coords: readonly number[],
  ): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().moveAnchors(anchorIds, coords));
  }

  removeAnchors(editId: PendingEditId, anchorIds: readonly AnchorId[]): boolean {
    return this.#applyEdit(editId, () => this.#buffers.peek().removeAnchors(anchorIds));
  }

  replace(state: GlyphState): void {
    this.#confirmedState = null;
    this.#pendingStates.clear();
    this.#publish(state);
  }

  replaceValues(values: Float64Array): void {
    this.replace({
      layerId: this.#layerId,
      structure: this.#editBaseState?.structure ?? this.#structure.peek(),
      values,
    });
  }

  rollbackEdit(editId: PendingEditId): void {
    const state = this.#pendingStates.get(editId);
    if (!state) return;

    this.#pendingStates.delete(editId);
    this.#publish(state);
    if (this.#pendingStates.size === 0) this.#confirmedState = null;
  }

  foldWorkspaceState(editId: PendingEditId | null, replacement: LayerReplaced): void {
    const confirmed = this.#confirmedState ?? this.#editBaseState ?? this.state;
    const state = {
      layerId: this.#layerId,
      structure: replacement.structure ?? confirmed.structure,
      values: replacement.values,
    };
    this.#confirmedState = state;

    if (editId !== null) this.#pendingStates.delete(editId);
    if (this.#pendingStates.size > 0) return;

    this.#confirmedState = null;
    this.#publish(state);
  }

  patchPositions(updates: GlyphPositions): void {
    this.#buffers.peek().patchPositions(updates);
  }

  /** Begins one reversible local edit against the current reactive layer. */
  beginEdit(reapply: () => void): void {
    if (this.#editBaseState) throw new Error("glyph layer already has an active edit");

    this.#editBaseState = this.state;
    this.#reapplyEdit = reapply;
  }

  /** Restores the latest accepted base, then applies the edit as pending workspace operations. */
  finishEdit(apply: () => void): void {
    const baseState = this.#editBaseState;
    if (!baseState) throw new Error("glyph layer has no active edit to finish");

    this.#editBaseState = null;
    this.#reapplyEdit = null;

    batch(() => {
      this.#publish(baseState);
      apply();
    });
  }

  /** Cancels the active edit and restores the latest accepted layer state. */
  cancelEdit(): void {
    const baseState = this.#editBaseState;
    if (!baseState) return;

    this.#editBaseState = null;
    this.#reapplyEdit = null;
    this.#publish(baseState);
  }

  /**
   * Applies one typed renderer operation and records its pre-edit snapshot once.
   *
   * The closure stays local to the layer model; it is never transported through
   * `LayerIntents` or interpreted as a `FontIntent`. Returning `false` means the
   * operation validated without mutating. Transactions reuse one edit identity,
   * so their first successful closure owns the rollback snapshot.
   */
  #applyEdit(editId: PendingEditId, operation: () => boolean): boolean {
    const alreadyPending = this.#pendingStates.has(editId);
    const before = alreadyPending ? null : this.state;

    return batch(() => {
      try {
        const applied = operation();
        if (!applied) return false;
        if (alreadyPending || !before) return true;

        if (this.#pendingStates.size === 0) this.#confirmedState = before;
        this.#pendingStates.set(editId, before);
        return true;
      } catch (error) {
        if (before) this.#publish(before);
        throw error;
      }
    });
  }

  #publish(state: GlyphState): void {
    batch(() => {
      const buffers = this.#buffers.peek();
      if (buffers.structure === state.structure) {
        buffers.replaceValues(state.values);
      } else {
        this.#buffers.set(LayerBuffers.fromState(state));
      }

      if (!this.#reapplyEdit) return;

      this.#editBaseState = this.state;
      this.#reapplyEdit();
    });
  }
}

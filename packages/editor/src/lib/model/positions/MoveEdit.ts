import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId } from "@shift/types";
import type { GlyphLayer } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import type {
  AxisSnap,
  PositionEdit,
  PositionEditPhase,
  PositionFeedback,
  PositionGuide,
  PositionSelectionLayer,
  PositionSnapProvider,
  PositionTargets,
} from "../../../types/positionEdit";
import { DirectionSnap } from "./DirectionSnap";
import type { MovementAxis } from "./MovementAxis";
import { PointRuleConstraint } from "./PointRuleConstraint";
import { PositionEditGroup } from "./PositionEditGroup";
import { PositionReference } from "./PositionReference";
import { nearerAxisSnap, settleSnap } from "./SnapSet";

/** Preview-backed movement configured with operation-specific fluent modifiers. */
export class MoveEdit implements PositionEdit {
  readonly #layers: PositionEditGroup;
  readonly #anchorIds: readonly AnchorId[];

  #additionalPointRules: Array<PointRuleConstraint | null>;

  #phase: PositionEditPhase = "configuring";
  #reference: Point2D | null = null;
  #directionSnap: DirectionSnap | null = null;
  #directionPivot: Point2D | null = null;
  #directionGuides = true;
  #axisDirection: Point2D | null = null;
  #snapProvider: PositionSnapProvider | null = null;
  #snapCandidates: readonly Point2D[] | null = null;
  #pointRules: PointRuleConstraint | null = null;

  constructor(
    layer: GlyphLayer,
    targets: PositionTargets,
    edit: GlyphLayerEdit | null = null,
    additionalLayers: readonly PositionSelectionLayer[] = [],
  ) {
    this.#layers = new PositionEditGroup(layer, targets, edit, additionalLayers);
    this.#anchorIds = [...(targets.anchors ?? [])];
    this.#additionalPointRules = additionalLayers.map(() => null);
  }

  /**
   * Freezes the moving reference used to turn drag deltas into snap candidates.
   *
   * @param reference - Point, anchor, or glyph-local position that moves with the targets, not the snap pivot.
   * @returns This edit for fluent configuration before its first preview.
   * @throws {Error} When preview has begun or the reference does not exist in the layer.
   */
  from(reference: PositionReference): this {
    this.#assertConfiguring();

    const position = reference.resolve(this.#layers.reference.layer);
    if (!position) throw new Error("Position reference does not exist in this glyph layer");

    this.#reference = position;
    return this;
  }

  /**
   * Attaches direction snapping and freezes its optional glyph-local pivot.
   *
   * @remarks
   * With a pivot, preview snaps the candidate reference's direction while preserving
   * its distance from that pivot. Without one, preview snaps the drag delta's direction.
   * A pivot requires `from(...)` before preview; the two configuration calls may be ordered either way.
   *
   * @param snap - Direction configuration with an optional fixed pivot and per-preview activation condition.
   * @returns This edit for fluent configuration before its first preview.
   * @throws {Error} When preview has begun or the configured pivot does not exist in the layer.
   */
  directionSnappedBy(snap: DirectionSnap): this {
    this.#assertConfiguring();
    this.#directionPivot = snap.resolvePivot(this.#layers.reference.layer);
    this.#directionGuides = snap.showsGuides;
    this.#directionSnap = snap;
    return this;
  }

  /**
   * Restricts every preview delta to one axis, after snapping.
   *
   * @param axis - Axis whose direction freezes on attachment; coincident ends leave movement free.
   * @returns This edit for fluent configuration before its first preview.
   * @throws {Error} When preview has begun or an axis end does not exist in the layer.
   */
  along(axis: MovementAxis): this {
    this.#assertConfiguring();
    this.#axisDirection = axis.resolveDirection(this.#layers.reference.layer);
    return this;
  }

  /**
   * Attaches position snapping, tested from one or several moving positions.
   *
   * @remarks
   * Every candidate is tested at its previewed position; the nearest correction
   * on each axis moves the whole edit, and candidates that land on the same
   * target all report guides.
   *
   * @param provider - Snap targets, usually a {@link SnapSet}.
   * @param candidates - Moving positions to test; defaults to the `from(...)` reference.
   * @returns This edit for fluent configuration before its first preview.
   * @throws {Error} When preview has begun or a candidate does not exist in the layer.
   */
  snappedBy(provider: PositionSnapProvider, candidates?: readonly PositionReference[]): this {
    this.#assertConfiguring();
    this.#snapProvider = provider;
    this.#snapCandidates =
      candidates?.map((candidate) => {
        const position = candidate.resolve(this.#layers.reference.layer);
        if (!position) throw new Error("Snap candidate does not exist in this glyph layer");
        return position;
      }) ?? null;
    return this;
  }

  constrainedBy(constraint: PointRuleConstraint): this {
    this.#assertConfiguring();
    this.#pointRules = constraint;
    this.#additionalPointRules = this.#layers.additional.map(({ layer, targets }) => {
      const pointIds = targets.points ?? [];
      return pointIds.length > 0
        ? PointRuleConstraint.forSelection(layer.geometry, pointIds)
        : null;
    });
    return this;
  }

  preview(rawDelta: Point2D): PositionFeedback {
    if (this.#snapProvider && !this.#snapCandidates && !this.#reference) {
      throw new Error("MoveEdit.snappedBy requires candidates or an explicit PositionReference");
    }

    if (this.#directionPivot && !this.#reference) {
      throw new Error(
        "Direction snapping around a pivot requires an explicit PositionReference via MoveEdit.from",
      );
    }

    this.#beginPreview();

    let delta = { ...rawDelta };
    const guides: PositionGuide[] = [];
    const directionDelta =
      this.#directionSnap?.apply(
        this.#directionPivot && this.#reference
          ? Vec2.sub(Vec2.add(this.#reference, delta), this.#directionPivot)
          : delta,
      ) ?? null;

    if (directionDelta) {
      delta =
        this.#directionPivot && this.#reference
          ? Vec2.sub(Vec2.add(this.#directionPivot, directionDelta), this.#reference)
          : directionDelta;
      if (this.#reference && this.#directionGuides) {
        guides.push({
          kind: "direction",
          from: { ...(this.#directionPivot ?? this.#reference) },
          to: Vec2.add(this.#reference, delta),
        });
      }
    }

    if (this.#snapProvider) {
      const settled = settleSnap(this.#snapCandidatesAt(this.#snapProvider, delta));
      delta = Vec2.add(delta, settled.offset);
      guides.push(...settled.guides);
    }

    if (this.#axisDirection) {
      delta = Vec2.project(delta, this.#axisDirection);
    }

    const reference = this.#layers.reference;
    const referencePositions = this.#pointRules
      ? this.#pointRules.positionsFor(reference.base.positions, this.#anchorIds, delta)
      : reference.base.translate(delta).positions;
    reference.include(referencePositions);
    reference.setPositions(referencePositions);

    for (const [index, layer] of this.#layers.additional.entries()) {
      const pointRules = this.#additionalPointRules[index];
      const positions = pointRules
        ? pointRules.positionsFor(layer.base.positions, layer.targets.anchors ?? [], delta)
        : layer.base.translate(delta).positions;
      layer.include(positions);
      layer.setPositions(positions);
    }

    return { delta, guides };
  }

  /**
   * Commits the preview and any scoped structural changes as one undoable edit.
   *
   * @param label - Undo label for the complete interaction; defaults to ordinary movement.
   */
  commit(label = "Move positions"): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#layers.finish(label);
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#layers.cancel();
  }

  #snapCandidatesAt(
    provider: PositionSnapProvider,
    delta: Point2D,
  ): { x: AxisSnap | null; y: AxisSnap | null } {
    const candidates = this.#snapCandidates ?? (this.#reference ? [this.#reference] : []);
    let x: AxisSnap | null = null;
    let y: AxisSnap | null = null;

    for (const candidate of candidates) {
      const snap = provider.snap(Vec2.add(candidate, delta));
      if (!snap) continue;

      x = nearerAxisSnap(x, snap.x);
      y = nearerAxisSnap(y, snap.y);
    }

    return { x, y };
  }

  #assertConfiguring(): void {
    if (this.#phase === "configuring") return;
    throw new Error("Position edit modifiers must be configured before the first preview");
  }

  #beginPreview(): void {
    switch (this.#phase) {
      case "configuring":
        this.#phase = "previewing";
        return;
      case "previewing":
        return;
      case "committed":
      case "discarded":
        throw new Error("Cannot preview a completed position edit");
    }
  }
}

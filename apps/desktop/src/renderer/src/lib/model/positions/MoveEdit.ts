import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId } from "@shift/types";
import type { GlyphLayer, GlyphLayerPositions } from "../Glyph";
import type { GlyphLayerEdit } from "../GlyphLayerEdit";
import { PositionList } from "./PositionList";
import type {
  PositionEdit,
  PositionEditPhase,
  PositionFeedback,
  PositionGuide,
  PositionSnapProvider,
  PositionTargets,
} from "@/types/positionEdit";
import { DirectionSnap } from "./DirectionSnap";
import { PointRuleConstraint } from "./PointRuleConstraint";
import { PositionReference } from "./PositionReference";

/** Preview-backed movement configured with operation-specific fluent modifiers. */
export class MoveEdit implements PositionEdit {
  readonly #layer: GlyphLayer;
  readonly #anchorIds: readonly AnchorId[];

  #base: PositionList;
  #edit: GlyphLayerEdit | null;

  #phase: PositionEditPhase = "configuring";
  #reference: Point2D | null = null;
  #directionSnap: DirectionSnap | null = null;
  #directionPivot: Point2D | null = null;
  #directionGuides = true;
  #snapProvider: PositionSnapProvider | null = null;
  #pointRules: PointRuleConstraint | null = null;

  constructor(layer: GlyphLayer, targets: PositionTargets, edit: GlyphLayerEdit | null = null) {
    this.#layer = layer;
    this.#base = PositionList.fromTargetGroups(layer, targets);
    this.#anchorIds = [...(targets.anchors ?? [])];
    this.#edit = edit;
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

    const position = reference.resolve(this.#layer);
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
    this.#directionPivot = snap.resolvePivot(this.#layer);
    this.#directionGuides = snap.showsGuides;
    this.#directionSnap = snap;
    return this;
  }

  snappedBy(provider: PositionSnapProvider): this {
    this.#assertConfiguring();
    this.#snapProvider = provider;
    return this;
  }

  constrainedBy(constraint: PointRuleConstraint): this {
    this.#assertConfiguring();
    this.#pointRules = constraint;
    return this;
  }

  preview(rawDelta: Point2D): PositionFeedback {
    if (this.#snapProvider && !this.#reference) {
      throw new Error("MoveEdit.snappedBy requires an explicit PositionReference");
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

    if (this.#snapProvider && this.#reference) {
      const snap = this.#snapProvider.snap(Vec2.add(this.#reference, delta));
      if (snap) {
        delta = Vec2.sub(snap.point, this.#reference);
        guides.push(...snap.guides);
      }
    }

    if (this.#pointRules) {
      this.#previewPositionPatch(
        this.#pointRules.positionsFor(this.#base.positions, this.#anchorIds, delta),
      );
    } else {
      this.#previewPositionPatch(this.#base.translate(delta).positions);
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
    this.#edit?.finish(label);
  }

  discard(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "discarded";
    this.#edit?.cancel();
  }

  #previewPositionPatch(positions: GlyphLayerPositions): void {
    if (positions.length === 0) return;

    this.#base = this.#base.includeFrom(this.#layer, positions);
    this.#edit ??= this.#layer.beginEdit();
    this.#edit.setPositions(positions);
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

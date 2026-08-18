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
  #snapProvider: PositionSnapProvider | null = null;
  #pointRules: PointRuleConstraint | null = null;

  constructor(layer: GlyphLayer, targets: PositionTargets, edit: GlyphLayerEdit | null = null) {
    this.#layer = layer;
    this.#base = PositionList.fromTargetGroups(layer, targets);
    this.#anchorIds = [...(targets.anchors ?? [])];
    this.#edit = edit;
  }

  from(reference: PositionReference): this {
    this.#assertConfiguring();

    const position = reference.resolve(this.#layer);
    if (!position) throw new Error("Position reference does not exist in this glyph layer");

    this.#reference = position;
    return this;
  }

  directionSnappedBy(snap: DirectionSnap): this {
    this.#assertConfiguring();
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

    this.#beginPreview();

    let delta = { ...rawDelta };
    const guides: PositionGuide[] = [];
    const directionDelta = this.#directionSnap?.apply(delta) ?? null;

    if (directionDelta) {
      delta = directionDelta;
      if (this.#reference) {
        guides.push({
          kind: "direction",
          from: this.#reference,
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

  commit(): void {
    if (this.#phase === "committed" || this.#phase === "discarded") return;

    this.#phase = "committed";
    this.#edit?.finish("Move positions");
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

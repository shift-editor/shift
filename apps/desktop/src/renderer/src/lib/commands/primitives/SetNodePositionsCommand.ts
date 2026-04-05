import type { GlyphSnapshot } from "@shift/types";
import { Glyphs } from "@shift/font";
import { BaseCommand, type CommandContext } from "../core/Command";
import type { NodePositionUpdate, NodePositionUpdateList } from "@/types/positionUpdate";

/**
 * Replays absolute point/anchor position updates in a single batched editing call.
 * Useful for undo/redo of large move-only operations where restoring the whole
 * glyph snapshot would be unnecessarily expensive.
 */
export class SetNodePositionsCommand extends BaseCommand<void> {
  readonly name: string;

  readonly #before: NodePositionUpdateList;
  readonly #after: NodePositionUpdateList;

  constructor(label: string, before: NodePositionUpdateList, after: NodePositionUpdateList) {
    super();
    this.name = label;
    this.#before = before;
    this.#after = after;
  }

  execute(ctx: CommandContext): void {
    ctx.fontEngine.setNodePositions(this.#after);
  }

  undo(ctx: CommandContext): void {
    ctx.fontEngine.setNodePositions(this.#before);
  }

  override redo(ctx: CommandContext): void {
    ctx.fontEngine.setNodePositions(this.#after);
  }

  static fromBaseGlyphAndUpdates(
    label: string,
    baseGlyph: GlyphSnapshot,
    after: NodePositionUpdateList,
  ): SetNodePositionsCommand | null {
    if (after.length === 0) return null;

    const pointPositions = new Map(
      Glyphs.getAllPoints(baseGlyph).map((point) => [point.id, point] as const),
    );
    const anchorPositions = new Map(
      baseGlyph.anchors.map((anchor) => [anchor.id, anchor] as const),
    );

    const before: NodePositionUpdate[] = [];

    for (const update of after) {
      switch (update.node.kind) {
        case "point": {
          const point = pointPositions.get(update.node.id);
          if (!point) return null;
          before.push({
            node: { kind: "point", id: point.id },
            x: point.x,
            y: point.y,
          });
          break;
        }
        case "anchor": {
          const anchor = anchorPositions.get(update.node.id);
          if (!anchor) return null;
          before.push({
            node: { kind: "anchor", id: anchor.id },
            x: anchor.x,
            y: anchor.y,
          });
          break;
        }
        case "guideline":
          return null;
      }
    }

    return new SetNodePositionsCommand(label, before, [...after]);
  }

  static fromGlyphDiff(
    label: string,
    before: GlyphSnapshot,
    after: GlyphSnapshot,
  ): SetNodePositionsCommand | null {
    if (
      before.unicode !== after.unicode ||
      before.name !== after.name ||
      before.xAdvance !== after.xAdvance ||
      before.activeContourId !== after.activeContourId ||
      before.contours.length !== after.contours.length ||
      before.anchors.length !== after.anchors.length
    ) {
      return null;
    }

    const beforeUpdates: NodePositionUpdate[] = [];
    const afterUpdates: NodePositionUpdate[] = [];

    for (let contourIndex = 0; contourIndex < before.contours.length; contourIndex += 1) {
      const beforeContour = before.contours[contourIndex];
      const afterContour = after.contours[contourIndex];

      if (
        !beforeContour ||
        !afterContour ||
        beforeContour.id !== afterContour.id ||
        beforeContour.closed !== afterContour.closed ||
        beforeContour.points.length !== afterContour.points.length
      ) {
        return null;
      }

      for (let pointIndex = 0; pointIndex < beforeContour.points.length; pointIndex += 1) {
        const beforePoint = beforeContour.points[pointIndex];
        const afterPoint = afterContour.points[pointIndex];

        if (
          !beforePoint ||
          !afterPoint ||
          beforePoint.id !== afterPoint.id ||
          beforePoint.pointType !== afterPoint.pointType ||
          beforePoint.smooth !== afterPoint.smooth
        ) {
          return null;
        }

        if (beforePoint.x === afterPoint.x && beforePoint.y === afterPoint.y) {
          continue;
        }

        beforeUpdates.push({
          node: { kind: "point", id: beforePoint.id },
          x: beforePoint.x,
          y: beforePoint.y,
        });
        afterUpdates.push({
          node: { kind: "point", id: afterPoint.id },
          x: afterPoint.x,
          y: afterPoint.y,
        });
      }
    }

    for (let anchorIndex = 0; anchorIndex < before.anchors.length; anchorIndex += 1) {
      const beforeAnchor = before.anchors[anchorIndex];
      const afterAnchor = after.anchors[anchorIndex];

      if (
        !beforeAnchor ||
        !afterAnchor ||
        beforeAnchor.id !== afterAnchor.id ||
        beforeAnchor.name !== afterAnchor.name
      ) {
        return null;
      }

      if (beforeAnchor.x === afterAnchor.x && beforeAnchor.y === afterAnchor.y) {
        continue;
      }

      beforeUpdates.push({
        node: { kind: "anchor", id: beforeAnchor.id },
        x: beforeAnchor.x,
        y: beforeAnchor.y,
      });
      afterUpdates.push({
        node: { kind: "anchor", id: afterAnchor.id },
        x: afterAnchor.x,
        y: afterAnchor.y,
      });
    }

    return new SetNodePositionsCommand(label, beforeUpdates, afterUpdates);
  }
}

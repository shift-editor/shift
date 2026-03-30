import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { AddPointCommand, InsertPointCommand } from "@/lib/commands";
import type { EditorAPI } from "../core/EditorAPI";
import type { AnchorData, HandleData } from "./types";

// export function continuePenContour(
//   editor: EditorAPI,
//   contourId: ContourId,
//   fromStart: boolean,
//   pointId: PointId,
// ): void {
//   editor.commands.withBatch("Continue Contour", () => {
//     editor.commands.execute(new SetActiveContourCommand(contourId));
//     if (fromStart) {
//       editor.commands.execute(new ReverseContourCommand(contourId));
//     }
//   });
//   editor.selectPoints([pointId]);
// }

// export function splitPenSegment(editor: EditorAPI, segment: Segment, t: number): PointId {
//   return editor.commands.withBatch("Split Segment", () =>
//     editor.commands.execute(new SplitSegmentCommand(segment, t)),
//   );
// }
//
// export function abandonPenContour(editor: EditorAPI): void {
//   editor.commands.withBatch("Abandon Contour", () => {
//     editor.clearSelection();
//     editor.commands.execute(new AddContourCommand());
//   });
// }

export function createPenHandles(
  editor: EditorAPI,
  anchor: AnchorData,
  snappedPos: Point2D,
): HandleData {
  const { context, pointId, position } = anchor;

  if (context.isFirstPoint) {
    const cpOutId = editor.commands.execute(
      new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false),
    );
    return { cpOut: cpOutId };
  }

  if (context.previousPointType === "onCurve") {
    if (context.previousOnCurvePosition) {
      const cp1Pos = Vec2.lerp(context.previousOnCurvePosition, position, 1 / 3);
      editor.commands.execute(
        new InsertPointCommand(pointId, cp1Pos.x, cp1Pos.y, "offCurve", false),
      );
    }

    const cpInPos = Vec2.mirror(snappedPos, position);
    const cpInId = editor.commands.execute(
      new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false),
    );
    return { cpIn: cpInId };
  }

  if (context.previousPointType === "offCurve") {
    const cpInPos = Vec2.mirror(snappedPos, position);
    const cpInId = editor.commands.execute(
      new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false),
    );
    const cpOutId = editor.commands.execute(
      new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false),
    );
    return { cpIn: cpInId, cpOut: cpOutId };
  }

  return {};
}

export function updatePenHandles(
  editor: EditorAPI,
  anchor: AnchorData,
  handles: HandleData,
  snappedPos: Point2D,
): void {
  if (handles.cpOut) {
    editor.movePointTo(handles.cpOut, snappedPos);
  }

  if (handles.cpIn) {
    const mirroredPos = Vec2.mirror(snappedPos, anchor.position);
    editor.movePointTo(handles.cpIn, mirroredPos);
  }
}

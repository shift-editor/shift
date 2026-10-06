import type { Editor } from "@shift/editor";
import type { AlignmentType } from "@shift/editor/transform";
import { Bounds, Mat } from "@shift/geo";
import type { ContourId } from "@shift/types";

export function alignSelection(editor: Editor, alignment: AlignmentType): boolean {
  if (editor.isEditing) return false;

  const selection = editor.positionSelection(editor.selection.ids);
  const pointIds = selection?.targets.points ?? [];
  if (!selection || pointIds.length < 2) return false;

  selection.layer.align(pointIds, alignment);
  return true;
}

export function flipSelection(editor: Editor, axis: "horizontal" | "vertical"): boolean {
  const ids = editor.selection.ids;
  const componentSelection = editor.componentTransformSelection(ids);
  if (componentSelection && !editor.isEditing) {
    componentSelection.layer.transformComponents(
      componentSelection,
      `Flip components ${axis === "horizontal" ? "horizontally" : "vertically"}`,
      ({ bounds }) => {
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const reflect = axis === "horizontal" ? Mat.ReflectVertical() : Mat.ReflectHorizontal();
        return Mat.Compose(
          Mat.Translate(center.x, center.y),
          Mat.Compose(reflect, Mat.Translate(-center.x, -center.y)),
        );
      },
    );
    return true;
  }

  if (editor.isEditing) return false;

  const selection = editor.positionSelection(ids);
  const pointIds = selection?.targets.points ?? [];
  const bounds = editor.selectionBounds();
  if (!selection || !bounds || pointIds.length === 0) return false;

  selection.layer.reflect(
    pointIds,
    axis === "horizontal" ? "vertical" : "horizontal",
    Bounds.center(bounds),
  );
  return true;
}

export function selectedBooleanContourIds(editor: Editor): readonly ContourId[] | null {
  const glyphNodes = editor.scene.nodesOfKind("glyph");
  if (glyphNodes.length !== 1) return null;

  const [glyphNode] = glyphNodes;
  if (!glyphNode) return null;

  const layer = editor.layerForGlyph(glyphNode.glyphId, glyphNode.sourceId);
  if (!layer) return null;

  const selectedIds = new Set(editor.selection.ids);
  const contourIds = layer.contours
    .filter(
      (contour) =>
        contour.closed &&
        (selectedIds.has(contour.id) || contour.points.every((point) => selectedIds.has(point.id))),
    )
    .map((contour) => contour.id);
  if (contourIds.length < 2) return null;

  return contourIds;
}

export async function applyBooleanSelection(
  editor: Editor,
  operation: "union" | "intersect" | "subtract",
): Promise<boolean> {
  const contourIds = selectedBooleanContourIds(editor);
  if (!contourIds || !editor.layerForGeometry({ contours: contourIds })) return false;

  const [contourIdA, contourIdB] = contourIds;
  if (!contourIdA || !contourIdB) return false;

  await editor.boolean(contourIdA, contourIdB, operation);
  return true;
}

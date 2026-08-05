import type { Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { GlyphNode } from "@/types/node";

export interface SelectedGeometryEdit {
  readonly layer: GlyphLayer;
  readonly node: GlyphNode;
  readonly pointIds: readonly PointId[];
  readonly anchorIds: readonly AnchorId[];
}

export function selectedGeometryEdit(editor: Editor): SelectedGeometryEdit | null {
  const objects = editor.objects(editor.selection.ids);
  if (objects.length !== editor.selection.ids.length) return null;

  let node: GlyphNode | null = null;
  const pointIds = new Set<PointId>();
  const anchorIds = new Set<AnchorId>();

  const useNode = (nextNode: GlyphNode): boolean => {
    if (node && node.id !== nextNode.id) return false;

    node = nextNode;
    return true;
  };

  for (const object of objects) {
    switch (object.kind) {
      case "point":
        if (!useNode(object.node)) return null;
        pointIds.add(object.pointId);
        break;

      case "anchor":
        if (!useNode(object.node)) return null;
        anchorIds.add(object.anchorId);
        break;

      case "segment":
        if (!useNode(object.node)) return null;
        for (const pointId of object.pointIds) pointIds.add(pointId);
        break;

      case "contour": {
        if (!useNode(object.node)) return null;
        const contour = object.geometry.contour(object.contourId);
        if (!contour) return null;

        for (const point of contour.points) pointIds.add(point.id);
        break;
      }

      case "node":
        return null;
    }
  }

  if (!node) return null;

  const layer = editor.layerForGeometry({ points: pointIds, anchors: anchorIds });
  if (!layer || layer.sourceId !== editor.activeSourceId) return null;

  return {
    layer,
    node,
    pointIds: [...pointIds],
    anchorIds: [...anchorIds],
  };
}

export function pointInSelectedNodeSpace(point: Point2D, edit: SelectedGeometryEdit): Point2D {
  return {
    x: point.x - edit.node.position.x,
    y: point.y - edit.node.position.y,
  };
}

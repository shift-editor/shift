import { Bounds } from "@shift/geo";
import type { ContourId, PointId, SelectableId } from "@shift/types";
import type { LayerExtent } from "@shift/wasm/protocol";
import type { Editor } from "../editor/Editor";
import type { GlyphLayer } from "../model/Glyph";
import { isUnreadLayerExtent } from "../model/layerExtent";
import { localBounds } from "../editor/spaces";
import type {
  TransformBoundsMeasure,
  TransformSelectionBounds,
} from "../../types/transformSelectionBounds";

type ContourSelection = "partial" | "wholeLayer" | { contours: ContourId[] };

/** Resolves transform-panel bounds: ink for whole stroked contours or the whole glyph. */
export function transformSelectionBounds(
  editor: Editor,
  ids = editor.selection.ids,
): TransformSelectionBounds | null {
  const position = editor.positionSelection(ids);
  if (!position) {
    const componentSelection = editor.componentTransformSelection(ids);
    if (!componentSelection) return null;

    return wholeLayerTransformBounds(editor, componentSelection.layer, ids);
  }

  const layer = position.layer;
  const selectedPoints = new Set(position.targets.points);
  if (selectedPoints.size === 0) return null;

  const measurePreference: TransformBoundsMeasure = editor.font.includeStrokeInMetricsCell.peek()
    ? "ink"
    : "skeleton";
  const contourSelection = classifyContourSelection(editor, layer, selectedPoints);
  if (contourSelection === "partial" || measurePreference === "skeleton") {
    const skeleton = editor.selectionBounds(ids);
    if (!skeleton) return null;
    return {
      bounds: skeleton,
      measure: "skeleton",
      layerId: layer.id,
      contourIds: [],
    };
  }

  const contourIds =
    contourSelection === "wholeLayer" ? ([] as ContourId[]) : contourSelection.contours;
  const extent = editor.font.selectionExtent(layer.id, contourIds);
  if (isUnreadLayerExtent(extent)) {
    const skeleton = editor.selectionBounds(ids);
    if (!skeleton) return null;
    return {
      bounds: skeleton,
      measure: "skeleton",
      layerId: layer.id,
      contourIds: [],
    };
  }

  return {
    bounds: localBoundsFromExtent(extent),
    measure: extent.effective === "ink" ? "ink" : "skeleton",
    layerId: layer.id,
    contourIds,
  };
}

function classifyContourSelection(
  editor: Editor,
  layer: GlyphLayer,
  selectedPoints: ReadonlySet<PointId>,
): ContourSelection {
  const strokeContours = new Set(editor.font.liveStrokeContours(layer.id));
  const wholeStroked: ContourId[] = [];

  for (const contour of layer.contours) {
    const pointIds = contour.points.map((point) => point.id);
    const selectedCount = pointIds.filter((id) => selectedPoints.has(id)).length;
    if (selectedCount === 0) continue;
    if (selectedCount < pointIds.length) return "partial";
    if (strokeContours.has(contour.id)) wholeStroked.push(contour.id);
  }

  const allAuthoredPoints = layer.allPoints.length;
  const wholeGlyphSelected = allAuthoredPoints > 0 && selectedPoints.size >= allAuthoredPoints;
  if (wholeGlyphSelected && (layer.contours.length > 0 || layer.components.length > 0)) {
    return "wholeLayer";
  }

  if (wholeStroked.length === 0) return "partial";
  return { contours: wholeStroked };
}

function localBoundsFromExtent(extent: LayerExtent) {
  return localBounds(
    Bounds.create({ x: extent.minX, y: extent.minY }, { x: extent.maxX, y: extent.maxY }),
  );
}

function wholeLayerTransformBounds(
  editor: Editor,
  layer: GlyphLayer,
  ids: readonly SelectableId[],
): TransformSelectionBounds | null {
  const layerComponents = layer.components;
  if (layerComponents.length === 0) return null;

  const selectedComponentIds = new Set(
    editor
      .objects(ids)
      .filter((object) => object.kind === "component")
      .map((object) => object.componentId),
  );
  const everyComponentSelected = layerComponents.every((component) =>
    selectedComponentIds.has(component.id),
  );
  if (!everyComponentSelected) return null;

  const measurePreference: TransformBoundsMeasure = editor.font.includeStrokeInMetricsCell.peek()
    ? "ink"
    : "skeleton";
  if (measurePreference === "skeleton") {
    const skeleton = editor.selectionBounds(ids);
    if (!skeleton) return null;
    return {
      bounds: skeleton,
      measure: "skeleton",
      layerId: layer.id,
      contourIds: [],
    };
  }

  const extent = editor.font.selectionExtent(layer.id, []);
  if (isUnreadLayerExtent(extent)) {
    const skeleton = editor.selectionBounds(ids);
    if (!skeleton) return null;
    return {
      bounds: skeleton,
      measure: "skeleton",
      layerId: layer.id,
      contourIds: [],
    };
  }

  return {
    bounds: localBoundsFromExtent(extent),
    measure: extent.effective === "ink" ? "ink" : "skeleton",
    layerId: layer.id,
    contourIds: [],
  };
}

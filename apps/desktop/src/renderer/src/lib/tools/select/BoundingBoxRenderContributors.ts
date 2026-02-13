import type { ToolRenderContributor } from "../core/ToolRenderContributor";
import { BOUNDING_RECTANGLE_STYLES } from "@/lib/styles/style";
import { renderBoundingRect, renderBoundingBoxHandles } from "@/lib/editor/rendering/passes";
import { isBoundingBoxVisibleAtZoom } from "./boundingBoxHitTest";

export const selectionBoundingRectContributor: ToolRenderContributor = {
  id: "selection-bounding-rect",
  layer: "static-scene-before-handles",
  visibility: "always",
  render({ editor, draw, lineWidthUpm }) {
    if (!draw) return;
    if (editor.isPreviewMode()) return;
    if (!editor.shouldRenderEditableGlyph()) return;
    const zoom = (editor as { getZoom?: () => number }).getZoom?.() ?? 1;
    if (!isBoundingBoxVisibleAtZoom(zoom)) return;

    const rect = editor.getSelectionBoundingRect();
    if (!rect) return;

    const renderer = draw.renderer;
    const offset = editor.getDrawOffset();
    renderer.save();
    renderer.translate(offset.x, offset.y);
    renderer.setStyle(BOUNDING_RECTANGLE_STYLES);
    renderer.lineWidth = lineWidthUpm(BOUNDING_RECTANGLE_STYLES.lineWidth);
    renderBoundingRect({ ctx: renderer, lineWidthUpm }, rect);
    renderer.restore();
  },
};

export const selectionBoundingHandleContributor: ToolRenderContributor = {
  id: "selection-bounding-handles",
  layer: "static-screen-after-handles",
  visibility: "always",
  render({ editor, renderer, projectGlyphLocalToScreen }) {
    if (!renderer) return;
    if (editor.isPreviewMode()) return;
    if (!editor.shouldRenderEditableGlyph()) return;
    const zoom = (editor as { getZoom?: () => number }).getZoom?.() ?? 1;
    if (!isBoundingBoxVisibleAtZoom(zoom)) return;

    const rect = editor.getSelectionBoundingRect();
    if (!rect) return;

    const topLeft = projectGlyphLocalToScreen({ x: rect.x, y: rect.y + rect.height });
    const bottomRight = projectGlyphLocalToScreen({ x: rect.x + rect.width, y: rect.y });
    const hoveredHandle = editor.getHoveredBoundingBoxHandle();

    renderBoundingBoxHandles(renderer, {
      rect: {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
        left: topLeft.x,
        top: topLeft.y,
        right: bottomRight.x,
        bottom: bottomRight.y,
      },
      hoveredHandle: hoveredHandle ?? undefined,
    });
  },
};

export const selectRenderContributors: readonly ToolRenderContributor[] = [
  selectionBoundingRectContributor,
  selectionBoundingHandleContributor,
];

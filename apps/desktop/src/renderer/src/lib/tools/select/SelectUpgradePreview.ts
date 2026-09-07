import { Vec2, type Point2D } from "@shift/geo";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { objectIsKindOf } from "@/types";
import type { Select } from "./Select";

const UPGRADE_PREVIEW_STYLE = { radiusPx: 3, fill: "#B0B0B0" } as const;

/** Draws prospective cubic handles without changing authored geometry. */
export class SelectUpgradePreview extends CanvasItem<readonly Point2D[]> {
  readonly #select: Select;

  constructor(select: Select) {
    super();
    this.#select = select;
  }

  protected props(): readonly Point2D[] | null {
    const editor = this.#select.editor;
    if (editor.sessionMode === "preview" || this.#select.stateCell.value.type !== "ready")
      return null;
    if (!editor.input.modifiersCell.value.metaKey || !editor.input.pointerCell.value) return null;

    const hover = editor.hover.entryCell.value;
    if (!hover) return null;

    const object = editor.object(hover);
    if (!objectIsKindOf(object, "segment")) return null;

    const layer = object.layer;
    if (!layer || layer.sourceId !== editor.activeSourceIdCell.value) return null;

    const segment = layer.geometryCell.value.segment(object.segmentId);
    if (!segment || segment.type !== "line") return null;

    return [1 / 3, 2 / 3].map((t) => Vec2.add(object.node.position, segment.pointAt(t)));
  }

  draw(canvas: Canvas): void {
    const points = this.propsCell.value;
    if (!points) return;

    for (const point of points) {
      canvas.circle(point, UPGRADE_PREVIEW_STYLE.radiusPx, UPGRADE_PREVIEW_STYLE.fill);
    }
  }
}

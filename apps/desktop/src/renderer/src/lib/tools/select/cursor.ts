import type { CursorType } from "@/types/editor";
import type { BoundingBoxHitResult } from "@/types/boundingBox";

export type BoundingRectEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | null;

export function edgeToCursor(edge: BoundingRectEdge): CursorType {
  switch (edge) {
    case "left":
    case "right":
      return { type: "ew-resize" };
    case "top":
    case "bottom":
      return { type: "ns-resize" };
    case "top-left":
    case "bottom-right":
      return { type: "nwse-resize" };
    case "top-right":
    case "bottom-left":
      return { type: "nesw-resize" };
    default:
      return { type: "default" };
  }
}

export function boundingBoxHitResultToCursor(result: BoundingBoxHitResult): CursorType {
  if (!result) {
    return { type: "default" };
  }

  if (result.type === "rotate") {
    switch (result.corner) {
      case "top-left":
        return { type: "rotate-tl" };
      case "top-right":
        return { type: "rotate-tr" };
      case "bottom-left":
        return { type: "rotate-bl" };
      case "bottom-right":
        return { type: "rotate-br" };
    }
  }

  return edgeToCursor(result.edge);
}

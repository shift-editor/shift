import type { CursorType } from "@/types/editor";

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

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

/**
 * Resolves the resize cursor for an original handle and its current axis reflections.
 *
 * @param edge - Handle chosen at drag start, or the currently hovered handle.
 * @param flipX - Whether the current X scale is negative; zero is unflipped.
 * @param flipY - Whether the current Y scale is negative; zero is unflipped.
 * @returns The reflected diagonal cursor, unchanged axis cursor, or default for no handle.
 */
export function edgeToCursor(edge: BoundingRectEdge, flipX = false, flipY = false): CursorType {
  switch (edge) {
    case "left":
    case "right":
      return { type: "ew-resize" };
    case "top":
    case "bottom":
      return { type: "ns-resize" };
    case "top-left":
    case "bottom-right":
      return { type: flipX !== flipY ? "nesw-resize" : "nwse-resize" };
    case "top-right":
    case "bottom-left":
      return { type: flipX !== flipY ? "nwse-resize" : "nesw-resize" };
    default:
      return { type: "default" };
  }
}

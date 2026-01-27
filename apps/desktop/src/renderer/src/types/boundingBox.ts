import type { BoundingRectEdge } from "@/lib/tools/select/cursor";

export type CornerHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type BoundingBoxHitResult =
  | { type: "resize"; edge: Exclude<BoundingRectEdge, null> }
  | { type: "rotate"; corner: CornerHandle }
  | null;

import type {
  TransformablePoint,
  SelectionBounds,
  AlignmentType,
  DistributeType,
} from "./types";

export const Alignment = {
  alignPoints(
    points: readonly TransformablePoint[],
    alignment: AlignmentType,
    bounds: SelectionBounds,
  ): TransformablePoint[] {
    if (points.length === 0) return [];

    switch (alignment) {
      case "left":
        return points.map((p) => ({ ...p, x: bounds.minX }));
      case "center-h":
        return points.map((p) => ({ ...p, x: bounds.center.x }));
      case "right":
        return points.map((p) => ({ ...p, x: bounds.maxX }));
      case "top":
        return points.map((p) => ({ ...p, y: bounds.maxY }));
      case "center-v":
        return points.map((p) => ({ ...p, y: bounds.center.y }));
      case "bottom":
        return points.map((p) => ({ ...p, y: bounds.minY }));
    }
  },

  distributePoints(
    points: readonly TransformablePoint[],
    type: DistributeType,
  ): TransformablePoint[] {
    if (points.length < 3) return [...points];

    const sorted = [...points].sort((a, b) =>
      type === "horizontal" ? a.x - b.x : a.y - b.y,
    );

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalSpan =
      type === "horizontal" ? last.x - first.x : last.y - first.y;
    const spacing = totalSpan / (sorted.length - 1);

    return sorted.map((p, i) => {
      if (i === 0 || i === sorted.length - 1) return p;
      if (type === "horizontal") {
        return { ...p, x: first.x + spacing * i };
      } else {
        return { ...p, y: first.y + spacing * i };
      }
    });
  },
} as const;

import { Bounds } from "@shift/geo";
import type { AlignmentType, DistributeType } from "./types";

type Coordinate = { readonly x: number; readonly y: number };

export const Alignment = {
  alignPoints<T extends Coordinate>(
    points: readonly T[],
    alignment: AlignmentType,
    bounds: Bounds,
  ): T[] {
    if (points.length === 0) return [];

    const center = Bounds.center(bounds);
    switch (alignment) {
      case "left":
        return points.map((p) => ({ ...p, x: bounds.min.x }));
      case "center-h":
        return points.map((p) => ({ ...p, x: center.x }));
      case "right":
        return points.map((p) => ({ ...p, x: bounds.max.x }));
      case "top":
        return points.map((p) => ({ ...p, y: bounds.max.y }));
      case "center-v":
        return points.map((p) => ({ ...p, y: center.y }));
      case "bottom":
        return points.map((p) => ({ ...p, y: bounds.min.y }));
    }
  },

  distributePoints<T extends Coordinate>(points: readonly T[], type: DistributeType): T[] {
    if (points.length < 3) return [...points];

    const sorted = [...points].sort((a, b) => (type === "horizontal" ? a.x - b.x : a.y - b.y));

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) {
      return sorted;
    }
    const totalSpan = type === "horizontal" ? last.x - first.x : last.y - first.y;
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

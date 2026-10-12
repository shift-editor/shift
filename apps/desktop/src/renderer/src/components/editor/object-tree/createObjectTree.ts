import { Mat, Polygon } from "@shift/geo";
import type { Contour, GlyphGeometry, Point } from "@shift/glyph-state";
import { ContourPath } from "@shift/editor/rendering";
import { Validate } from "@shift/validation";
import type { ContourId } from "@shift/types";
import type { ContourDirection, ObjectTree, ObjectTreeItem } from "@/types/objectTree";

const CONTOUR_ICON_SIZE = 14;
const CONTOUR_ICON_PADDING = 1;

/**
 * Builds the Objects panel tree for a glyph's geometry.
 *
 * @param cache - reuses each contour's item while its points are unchanged; pass
 * the same cache across edits so an edit rebuilds only the contours it touched.
 */
export function createObjectTree(
  geometry: GlyphGeometry,
  cache: ObjectTreeCache = new ObjectTreeCache(),
): ObjectTree {
  return [
    {
      id: "contours",
      label: "Contours",
      items: cache.contourItems(geometry.contours),
    },
    {
      id: "anchors",
      label: "Anchors",
      items: geometry.anchors.map((anchor, anchorIndex) => ({
        id: anchor.id,
        kind: "anchor",
        icon: "anchor",
        label: anchor.name?.trim() || `Anchor ${anchorIndex + 1}`,
        children: [],
      })),
    },
    {
      id: "components",
      label: "Components",
      items: geometry.components.map((component, componentIndex) => ({
        id: component.id,
        kind: "component",
        icon: "component",
        label: component.baseGlyphName || `Component ${componentIndex + 1}`,
        children: [],
      })),
    },
  ];
}

interface CachedContour {
  readonly index: number;
  readonly closed: boolean;
  /** The contour's points when captured; ids, types, and smoothness are compared. */
  readonly points: readonly Point[];
  readonly item: ObjectTreeItem;
}

/**
 * Contour items from the previous build, keyed by contour id.
 *
 * @remarks
 * Every row, label, icon, and direction in a contour's item comes from its index,
 * closedness, point identities and types, and coordinates. An edit to one contour
 * of a 50K-point glyph otherwise rebuilt every row and contour icon on each click.
 */
export class ObjectTreeCache {
  #contours = new Map<ContourId, CachedContour>();

  contourItems(contours: readonly Contour[]): ObjectTreeItem[] {
    const next = new Map<ContourId, CachedContour>();
    const items = contours.map((contour, index) => {
      const previous = this.#contours.get(contour.id);
      const cached =
        previous && matches(previous, contour, index) ? previous : capture(contour, index);
      next.set(contour.id, cached);
      return cached.item;
    });
    this.#contours = next;
    return items;
  }
}

function matches(cached: CachedContour, contour: Contour, index: number): boolean {
  const points = contour.points;
  if (
    cached.index !== index ||
    cached.closed !== contour.closed ||
    cached.points.length !== points.length
  ) {
    return false;
  }

  for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex]!;
    const previous = cached.points[pointIndex]!;
    if (
      point.x !== previous.x ||
      point.y !== previous.y ||
      point.id !== previous.id ||
      point.pointType !== previous.pointType ||
      point.smooth !== previous.smooth
    ) {
      return false;
    }
  }
  return true;
}

function capture(contour: Contour, index: number): CachedContour {
  return {
    index,
    closed: contour.closed,
    points: contour.points,
    item: contourItem(contour, index),
  };
}

function contourItem(contour: Contour, contourIndex: number): ObjectTreeItem {
  const pointCounts = { curve: 0, handle: 0, line: 0 };
  const curveEndpointIds = curveEndpoints(contour);

  return {
    id: contour.id,
    kind: "contour",
    icon: "contour",
    iconPath: createContourIconPath(contour),
    direction: contourDirection(contour),
    label: `Contour ${contourIndex + 1}`,
    children: contour.points.map((point, pointIndex) => {
      if (pointIndex === 0) {
        return { id: point.id, kind: "point", icon: "first", label: "First", children: [] };
      }

      const icon = pointIcon(point, curveEndpointIds);
      pointCounts[icon] += 1;

      return {
        id: point.id,
        kind: "point",
        icon,
        label: pointLabel(icon, pointCounts[icon]),
        children: [],
      };
    }),
  };
}

export function createContourIconPath(contour: Contour): string | undefined {
  const bounds = contour.bounds;
  if (!bounds) return undefined;

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const longestSide = Math.max(width, height);
  if (longestSide === 0) return undefined;

  const contentSize = CONTOUR_ICON_SIZE - CONTOUR_ICON_PADDING * 2;
  const scale = contentSize / longestSide;
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const translateX = CONTOUR_ICON_PADDING + (contentSize - scaledWidth) / 2 - bounds.min.x * scale;
  const translateY = CONTOUR_ICON_PADDING + (contentSize - scaledHeight) / 2 + bounds.max.y * scale;
  const transform = new Mat(scale, 0, 0, -scale, translateX, translateY);

  return ContourPath.fromContour(contour, transform).svgPath;
}

function contourDirection(contour: Contour): ContourDirection | undefined {
  if (!contour.closed) return undefined;
  return Polygon.isClockwise(contour.points) ? "clockwise" : "counterclockwise";
}

function pointLabel(icon: "curve" | "handle" | "line", count: number): string {
  switch (icon) {
    case "curve":
      return `Curve ${count}`;
    case "handle":
      return `Handle ${count}`;
    case "line":
      return `Line ${count}`;
  }
}

function pointIcon(point: Point, curveEndpointIds: ReadonlySet<string>) {
  if (Validate.isOffCurve(point)) return "handle";
  return curveEndpointIds.has(point.id) ? "curve" : "line";
}

/** On-curve points that start or end a curve segment; walked once per contour. */
function curveEndpoints(contour: Contour): Set<string> {
  const ids = new Set<string>();
  for (const segment of contour.segments()) {
    if (segment.type === "line") continue;
    ids.add(segment.startId);
    ids.add(segment.endId);
  }
  return ids;
}

import { Mat } from "@shift/geo";
import type { Contour, GlyphGeometry, Point } from "@shift/glyph-state";
import { ContourPath } from "@shift/editor/rendering";
import { Validate } from "@shift/validation";
import type { ObjectTree } from "@/types/objectTree";

const CONTOUR_ICON_SIZE = 14;
const CONTOUR_ICON_PADDING = 1;

export function createObjectTree(geometry: GlyphGeometry): ObjectTree {
  return [
    {
      id: "contours",
      label: "Contours",
      items: geometry.contours.map((contour, contourIndex) => {
        const pointCounts = { curve: 0, handle: 0, line: 0 };

        return {
          id: contour.id,
          kind: "contour",
          icon: "contour",
          iconPath: createContourIconPath(contour),
          label: `Contour ${contourIndex + 1}`,
          children: contour.points.map((point, pointIndex) => {
            const icon = pointIcon(contour, point);
            let label = "First";

            if (pointIndex !== 0) {
              pointCounts[icon] += 1;

              switch (icon) {
                case "curve":
                  label = `Curve ${pointCounts.curve}`;
                  break;
                case "handle":
                  label = `Handle ${pointCounts.handle}`;
                  break;
                case "line":
                  label = `Line ${pointCounts.line}`;
                  break;
              }
            }

            return {
              id: point.id,
              kind: "point",
              icon,
              label,
              children: [],
            };
          }),
        };
      }),
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

function pointIcon(contour: Contour, point: Point) {
  if (Validate.isOffCurve(point)) return "handle";

  const adjoiningSegments = contour
    .segments()
    .filter((segment) => segment.startId === point.id || segment.endId === point.id);
  return adjoiningSegments.some((segment) => segment.type !== "line") ? "curve" : "line";
}

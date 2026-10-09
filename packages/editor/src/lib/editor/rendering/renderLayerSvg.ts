import type { Bounds } from "@shift/geo";
import type { GlyphGeometry } from "@shift/glyph-state";
import type { ResolvedLayerGeometry, SourceMetrics } from "@shift/types";
import { Validate } from "@shift/validation";
import { Svg, type SvgChild } from "./Svg";

type LayerSvgAppearance = {
  outlineFill?: string;
  onCurveStroke?: string;
  offCurveStroke?: string;
  handleFill?: string;
  controlStroke?: string;
  anchorStroke?: string;
  metricStroke?: string;
  advanceStroke?: string;
  componentStroke?: string;
};

type LayerSvgOverlays = {
  points?: boolean;
  controlLines?: boolean;
  anchors?: boolean;
  components?: boolean;
  fontMetrics?: boolean;
  advanceWidth?: boolean;
};

type ViewBox = [number, number, number, number];

const DEFAULT_APPEARANCE: Required<LayerSvgAppearance> = {
  outlineFill: "#0A0A0A",
  onCurveStroke: "#0C92F4",
  offCurveStroke: "#888888",
  handleFill: "#FFFFFF",
  controlStroke: "#888888",
  anchorStroke: "#6B15EC",
  metricStroke: "#A3A3A3",
  advanceStroke: "#C8C8C4",
  componentStroke: "#0C92F4",
};

/**
 * Renders one authored layer as portable SVG with optional source annotations.
 *
 * @remarks
 * Pure presentation: both geometries must come from one accepted-state layer
 * read. Nothing here loads glyphs or resolves components.
 *
 * @param input.authored - Point-in-time authored geometry for points, anchors, and guides.
 * @param input.resolved - Composited outline and direct component subtrees of the same layer.
 * @param input.metrics - Source-resolved font metrics used for scale and semantic guides.
 * @param input.overlays - Source annotations to include around the outline.
 * @param input.appearance - Optional presentation overrides for semantic SVG elements.
 * @returns SVG markup, its numeric view box, and structured guide data.
 */
export function renderLayerSvg({
  authored,
  resolved,
  metrics,
  overlays = {},
  appearance = {},
}: {
  authored: GlyphGeometry;
  resolved: ResolvedLayerGeometry;
  metrics: SourceMetrics;
  overlays?: LayerSvgOverlays;
  appearance?: LayerSvgAppearance;
}) {
  const em =
    Number.isFinite(metrics.unitsPerEm) && metrics.unitsPerEm > 0 ? metrics.unitsPerEm : 1000;
  const colors = { ...DEFAULT_APPEARANCE, ...appearance };
  const viewBox = layerViewBox(authored, resolved.outline.bounds ?? null, metrics, em, overlays);
  const svg = Svg.document(viewBox, { "data-shift-role": "authored-layer" }, [
    overlays.fontMetrics && renderFontMetrics(metrics, viewBox, em, colors.metricStroke),
    overlays.advanceWidth &&
      renderAdvanceWidth(authored.xAdvance, viewBox, em, colors.advanceStroke),
    Svg.element("path", {
      "data-shift-role": "outline",
      d: resolved.outline.svgPath,
      fill: colors.outlineFill,
      "fill-rule": "nonzero",
      transform: "scale(1 -1)",
    }),
    overlays.controlLines && renderControlLines(authored, em, colors.controlStroke),
    overlays.points && renderPoints(authored, em, colors),
    overlays.anchors && renderAnchors(authored, em, colors),
    overlays.components && renderComponents(resolved.components, em, colors),
  ]);

  return {
    viewBox,
    guides: {
      fontMetrics: {
        ascender: metrics.ascender,
        ...(metrics.capHeight === undefined ? {} : { capHeight: metrics.capHeight }),
        ...(metrics.xHeight === undefined ? {} : { xHeight: metrics.xHeight }),
        baseline: metrics.baseline,
        descender: metrics.descender,
      },
      advanceWidth: { origin: 0, advance: authored.xAdvance },
    },
    svg: String(svg),
  };
}

function layerViewBox(
  authored: GlyphGeometry,
  bounds: Bounds | null,
  metrics: SourceMetrics,
  unitsPerEm: number,
  overlays: LayerSvgOverlays,
): ViewBox {
  const padding = unitsPerEm * 0.08;
  const overlayPoints = [
    ...(overlays.points ? authored.allPoints : []),
    ...(overlays.anchors ? authored.anchors : []),
  ];
  const metricPositions = overlays.fontMetrics
    ? [
        metrics.ascender,
        metrics.capHeight,
        metrics.xHeight,
        metrics.baseline,
        metrics.descender,
      ].filter((position): position is number => position !== undefined)
    : [];
  const overlayXs = overlayPoints.map(({ x }) => x);
  const overlayYs = [
    ...overlayPoints.map(({ y }) => -y),
    ...metricPositions.map((position) => -position),
  ];
  const minX = Math.min(0, bounds?.min.x ?? 0, ...overlayXs) - padding;
  const maxX =
    Math.max(authored.xAdvance, bounds?.max.x ?? authored.xAdvance, ...overlayXs) + padding;
  const top = Math.min(-(bounds?.max.y ?? unitsPerEm * 0.8), ...overlayYs) - padding;
  const bottom = Math.max(-(bounds?.min.y ?? -unitsPerEm * 0.2), ...overlayYs) + padding;
  const width = Math.max(maxX - minX, padding * 2);
  const height = Math.max(bottom - top, padding * 2);

  return [minX, top, width, height];
}

function renderFontMetrics(
  metrics: SourceMetrics,
  viewBox: ViewBox,
  unitsPerEm: number,
  color: string,
): Svg {
  const [left, , width] = viewBox;
  const rows: readonly (readonly [string, number | undefined])[] = [
    ["ascender", metrics.ascender],
    ["capHeight", metrics.capHeight],
    ["xHeight", metrics.xHeight],
    ["baseline", metrics.baseline],
    ["descender", metrics.descender],
  ];
  const elements = rows.map(([kind, position]) => {
    if (position === undefined) return null;

    const y = -position;
    return Svg.group({ "data-shift-role": "font-metric", "data-shift-metric": kind }, [
      Svg.element("line", { x1: left, y1: y, x2: left + width, y2: y }),
      Svg.element(
        "text",
        {
          x: left + unitsPerEm * 0.01,
          y: y - unitsPerEm * 0.01,
          fill: color,
          stroke: "none",
          "font-family": "system-ui, sans-serif",
          "font-size": unitsPerEm * 0.014,
        },
        [Svg.text(kind)],
      ),
    ]);
  });

  return Svg.group(
    {
      "data-shift-role": "font-metrics",
      fill: "none",
      stroke: color,
      "stroke-width": unitsPerEm * 0.001,
    },
    elements,
  );
}

function renderAdvanceWidth(
  xAdvance: number,
  viewBox: ViewBox,
  unitsPerEm: number,
  color: string,
): Svg {
  const [, top, , height] = viewBox;
  const bottom = top + height;

  return Svg.group(
    {
      "data-shift-role": "advance-width",
      fill: "none",
      stroke: color,
      "stroke-width": unitsPerEm * 0.001,
    },
    [
      Svg.element("line", { "data-shift-guide": "origin", x1: 0, y1: top, x2: 0, y2: bottom }),
      Svg.element("line", {
        "data-shift-guide": "advance",
        x1: xAdvance,
        y1: top,
        x2: xAdvance,
        y2: bottom,
      }),
    ],
  );
}

function renderControlLines(authored: GlyphGeometry, unitsPerEm: number, color: string): SvgChild {
  const lines: Svg[] = [];

  for (const contour of authored.contours) {
    for (const segment of contour.segments()) {
      const points = segment.points;
      switch (points.type) {
        case "line":
          break;
        case "quad":
          lines.push(controlLine(points.end, points.control));
          break;
        case "cubic":
          lines.push(controlLine(points.start, points.controlStart));
          lines.push(controlLine(points.end, points.controlEnd));
          break;
      }
    }
  }

  if (lines.length === 0) return null;

  return Svg.group(
    {
      "data-shift-role": "control-lines",
      fill: "none",
      stroke: color,
      "stroke-opacity": 0.65,
      "stroke-width": unitsPerEm * 0.001,
    },
    lines,
  );
}

function controlLine(from: { x: number; y: number }, to: { x: number; y: number }): Svg {
  return Svg.element("line", {
    "data-shift-role": "control-line",
    x1: from.x,
    y1: -from.y,
    x2: to.x,
    y2: -to.y,
  });
}

function renderPoints(
  authored: GlyphGeometry,
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): Svg {
  const radius = unitsPerEm * 0.005;
  const strokeWidth = unitsPerEm * 0.0015;
  const points: Svg[] = [];

  for (const contour of authored.contours) {
    for (const point of contour.points) {
      const offCurve = Validate.isOffCurve(point);
      let kind = "corner";
      if (offCurve) kind = "offCurve";
      else if (point.smooth) kind = "smooth";
      const common = {
        id: `shift-${safeId(point.id)}`,
        "data-shift-role": "point",
        "data-shift-id": point.id,
        "data-shift-kind": kind,
        "data-shift-point-type": point.pointType,
      };

      if (offCurve || point.smooth) {
        points.push(
          Svg.element("circle", {
            ...common,
            cx: point.x,
            cy: -point.y,
            r: radius,
            fill: colors.handleFill,
            stroke: offCurve ? colors.offCurveStroke : colors.onCurveStroke,
            "stroke-width": strokeWidth,
          }),
        );
        continue;
      }

      points.push(
        Svg.element("rect", {
          ...common,
          x: point.x - radius,
          y: -point.y - radius,
          width: radius * 2,
          height: radius * 2,
          fill: colors.handleFill,
          stroke: colors.onCurveStroke,
          "stroke-width": strokeWidth,
        }),
      );
    }
  }

  return Svg.group({ "data-shift-role": "points" }, points);
}

function renderAnchors(
  authored: GlyphGeometry,
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): Svg {
  const radius = unitsPerEm * 0.006;
  const anchors = authored.anchors.map((anchor) =>
    Svg.group(
      { id: `shift-${safeId(anchor.id)}`, "data-shift-role": "anchor", "data-shift-id": anchor.id },
      [
        Svg.element("circle", {
          cx: anchor.x,
          cy: -anchor.y,
          r: radius,
          fill: colors.handleFill,
          stroke: colors.anchorStroke,
          "stroke-width": unitsPerEm * 0.0015,
        }),
        anchor.name
          ? Svg.element(
              "text",
              {
                x: anchor.x + radius * 1.8,
                y: -anchor.y - radius * 1.8,
                fill: colors.anchorStroke,
                "font-family": "system-ui, sans-serif",
                "font-size": unitsPerEm * 0.018,
              },
              [Svg.text(anchor.name)],
            )
          : null,
      ],
    ),
  );

  return Svg.group({ "data-shift-role": "anchors" }, anchors);
}

function renderComponents(
  components: ResolvedLayerGeometry["components"],
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): SvgChild {
  const strokeWidth = unitsPerEm * 0.0015;
  const radius = unitsPerEm * 0.006;
  const rendered = components.flatMap((component) => {
    const bounds = component.outline.bounds;
    if (!bounds) return [];

    return Svg.group({ "data-shift-role": "component", "data-shift-id": component.id }, [
      Svg.element("rect", {
        x: bounds.min.x,
        y: -bounds.max.y,
        width: bounds.max.x - bounds.min.x,
        height: bounds.max.y - bounds.min.y,
        fill: "none",
        stroke: colors.componentStroke,
        "stroke-width": strokeWidth,
        "stroke-dasharray": `${Svg.number(radius)} ${Svg.number(radius)}`,
      }),
      Svg.element("circle", {
        cx: component.transformation.dx,
        cy: -component.transformation.dy,
        r: radius,
        fill: colors.handleFill,
        stroke: colors.componentStroke,
        "stroke-width": strokeWidth,
      }),
    ]);
  });

  return rendered.length > 0 && Svg.group({ "data-shift-role": "components" }, rendered);
}

function safeId(value: string): string {
  return value.replaceAll(
    /[^A-Za-z0-9_.-]/g,
    (character) => `_${character.codePointAt(0)?.toString(16)}`,
  );
}

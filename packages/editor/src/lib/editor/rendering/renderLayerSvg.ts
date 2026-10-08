import { Mat, type Bounds, type MatModel } from "@shift/geo";
import type { GlyphGeometry } from "@shift/glyph-state";
import type { ComponentId, SourceMetrics } from "@shift/types";
import { Validate } from "@shift/validation";
import { ContourPath } from "../../graphics/ContourPath";

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

type ResolvedComponent = {
  componentId: ComponentId;
  parentPath: readonly ComponentId[];
  contours: readonly { svgPath: string }[];
  bounds: Bounds | null;
  resolvedTransform: MatModel;
};

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
 * @param geometry - Point-in-time authored geometry to encode.
 * @param metrics - Source-resolved font metrics used for scale and semantic guides.
 * @param overlays - Source annotations to include around the outline.
 * @param components - Canvas-resolved component occurrences, including nested outlines.
 * @param appearance - Optional presentation overrides for semantic SVG elements.
 * @returns SVG markup, its numeric view box, and structured guide data.
 */
export function renderLayerSvg(
  geometry: GlyphGeometry,
  metrics: SourceMetrics,
  overlays: {
    points?: boolean;
    controlLines?: boolean;
    anchors?: boolean;
    components?: boolean;
    fontMetrics?: boolean;
    advanceWidth?: boolean;
  } = {},
  components: readonly ResolvedComponent[] = [],
  appearance: LayerSvgAppearance = {},
) {
  const em =
    Number.isFinite(metrics.unitsPerEm) && metrics.unitsPerEm > 0 ? metrics.unitsPerEm : 1000;
  const colors = { ...DEFAULT_APPEARANCE, ...appearance };
  const viewBox = layerViewBox(geometry, metrics, em, overlays, components);
  const outline = [
    ...geometry.contours.map((contour) => ContourPath.fromContour(contour, Mat.Identity()).svgPath),
    ...components.flatMap((component) => component.contours.map((contour) => contour.svgPath)),
  ]
    .filter(Boolean)
    .join(" ");
  const groups = [
    overlays.fontMetrics ? renderFontMetrics(metrics, viewBox, em, colors.metricStroke) : "",
    overlays.advanceWidth
      ? renderAdvanceWidth(geometry.xAdvance, viewBox, em, colors.advanceStroke)
      : "",
    `<path data-shift-role="outline" d="${escapeXml(outline)}" fill="${escapeXml(colors.outlineFill)}" fill-rule="nonzero" transform="scale(1 -1)"/>`,
    overlays.controlLines ? renderControlLines(geometry, em, colors.controlStroke) : "",
    overlays.points ? renderPoints(geometry, em, colors) : "",
    overlays.anchors ? renderAnchors(geometry, em, colors) : "",
    overlays.components ? renderComponents(components, em, colors) : "",
  ].filter(Boolean);
  const viewBoxText = viewBox.map(svgNumber).join(" ");

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
      advanceWidth: { origin: 0, advance: geometry.xAdvance },
    },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxText}" data-shift-role="authored-layer">${groups.join("")}</svg>`,
  };
}

function layerViewBox(
  geometry: GlyphGeometry,
  metrics: SourceMetrics,
  unitsPerEm: number,
  overlays: {
    points?: boolean;
    anchors?: boolean;
    fontMetrics?: boolean;
  },
  components: readonly { bounds: Bounds | null }[],
): [number, number, number, number] {
  const padding = unitsPerEm * 0.08;
  const bounds = [geometry.bounds, ...components.map((component) => component.bounds)].reduce(
    (combined, current) => {
      if (!current) return combined;
      if (!combined) return current;
      return {
        min: {
          x: Math.min(combined.min.x, current.min.x),
          y: Math.min(combined.min.y, current.min.y),
        },
        max: {
          x: Math.max(combined.max.x, current.max.x),
          y: Math.max(combined.max.y, current.max.y),
        },
      };
    },
    null as Bounds | null,
  );
  const overlayPoints = [
    ...(overlays.points ? geometry.allPoints : []),
    ...(overlays.anchors ? geometry.anchors : []),
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
    Math.max(geometry.xAdvance, bounds?.max.x ?? geometry.xAdvance, ...overlayXs) + padding;
  const top = Math.min(-(bounds?.max.y ?? unitsPerEm * 0.8), ...overlayYs) - padding;
  const bottom = Math.max(-(bounds?.min.y ?? -unitsPerEm * 0.2), ...overlayYs) + padding;
  const width = Math.max(maxX - minX, padding * 2);
  const height = Math.max(bottom - top, padding * 2);

  return [minX, top, width, height];
}

function renderFontMetrics(
  metrics: SourceMetrics,
  viewBox: readonly [number, number, number, number],
  unitsPerEm: number,
  color: string,
): string {
  const [left, , width] = viewBox;
  const strokeWidth = unitsPerEm * 0.001;
  const fontSize = unitsPerEm * 0.014;
  const rows: readonly (readonly [string, number | undefined])[] = [
    ["ascender", metrics.ascender],
    ["capHeight", metrics.capHeight],
    ["xHeight", metrics.xHeight],
    ["baseline", metrics.baseline],
    ["descender", metrics.descender],
  ];
  const elements = rows.flatMap(([kind, position]) => {
    if (position === undefined) return [];

    const y = -position;
    return `<g data-shift-role="font-metric" data-shift-metric="${kind}"><line x1="${svgNumber(left)}" y1="${svgNumber(y)}" x2="${svgNumber(left + width)}" y2="${svgNumber(y)}"/><text x="${svgNumber(left + unitsPerEm * 0.01)}" y="${svgNumber(y - unitsPerEm * 0.01)}" fill="${escapeXml(color)}" stroke="none" font-family="system-ui, sans-serif" font-size="${svgNumber(fontSize)}">${kind}</text></g>`;
  });

  return `<g data-shift-role="font-metrics" fill="none" stroke="${escapeXml(color)}" stroke-width="${svgNumber(strokeWidth)}">${elements.join("")}</g>`;
}

function renderAdvanceWidth(
  xAdvance: number,
  viewBox: readonly [number, number, number, number],
  unitsPerEm: number,
  color: string,
): string {
  const [, top, , height] = viewBox;
  const bottom = top + height;
  const strokeWidth = unitsPerEm * 0.001;

  return `<g data-shift-role="advance-width" fill="none" stroke="${escapeXml(color)}" stroke-width="${svgNumber(strokeWidth)}"><line data-shift-guide="origin" x1="0" y1="${svgNumber(top)}" x2="0" y2="${svgNumber(bottom)}"/><line data-shift-guide="advance" x1="${svgNumber(xAdvance)}" y1="${svgNumber(top)}" x2="${svgNumber(xAdvance)}" y2="${svgNumber(bottom)}"/></g>`;
}

function renderControlLines(geometry: GlyphGeometry, unitsPerEm: number, color: string): string {
  const lines: string[] = [];

  for (const contour of geometry.contours) {
    for (const segment of contour.segments()) {
      const points = segment.points;
      switch (points.type) {
        case "line":
          break;
        case "quad":
          lines.push(svgLine(points.end, points.control));
          break;
        case "cubic":
          lines.push(svgLine(points.start, points.controlStart));
          lines.push(svgLine(points.end, points.controlEnd));
          break;
      }
    }
  }

  if (lines.length === 0) return "";

  const strokeWidth = unitsPerEm * 0.001;
  return `<g data-shift-role="control-lines" fill="none" stroke="${escapeXml(color)}" stroke-opacity="0.65" stroke-width="${svgNumber(strokeWidth)}">${lines.join("")}</g>`;
}

function svgLine(from: { x: number; y: number }, to: { x: number; y: number }): string {
  return `<line data-shift-role="control-line" x1="${svgNumber(from.x)}" y1="${svgNumber(-from.y)}" x2="${svgNumber(to.x)}" y2="${svgNumber(-to.y)}"/>`;
}

function renderPoints(
  geometry: GlyphGeometry,
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): string {
  const radius = unitsPerEm * 0.005;
  const cornerSize = radius * 2;
  const strokeWidth = unitsPerEm * 0.0015;
  const points: string[] = [];

  for (const contour of geometry.contours) {
    for (const point of contour.points) {
      const id = escapeXml(point.id);
      const x = svgNumber(point.x);
      const y = svgNumber(-point.y);
      const offCurve = Validate.isOffCurve(point);
      let kind = "corner";
      if (offCurve) kind = "offCurve";
      else if (point.smooth) kind = "smooth";
      const common = `id="shift-${safeId(point.id)}" data-shift-role="point" data-shift-id="${id}" data-shift-kind="${kind}" data-shift-point-type="${point.pointType}"`;

      if (offCurve || point.smooth) {
        const stroke = offCurve ? colors.offCurveStroke : colors.onCurveStroke;
        points.push(
          `<circle ${common} cx="${x}" cy="${y}" r="${svgNumber(radius)}" fill="${escapeXml(colors.handleFill)}" stroke="${escapeXml(stroke)}" stroke-width="${svgNumber(strokeWidth)}"/>`,
        );
        continue;
      }

      points.push(
        `<rect ${common} x="${svgNumber(point.x - radius)}" y="${svgNumber(-point.y - radius)}" width="${svgNumber(cornerSize)}" height="${svgNumber(cornerSize)}" fill="${escapeXml(colors.handleFill)}" stroke="${escapeXml(colors.onCurveStroke)}" stroke-width="${svgNumber(strokeWidth)}"/>`,
      );
    }
  }

  return `<g data-shift-role="points">${points.join("")}</g>`;
}

function renderAnchors(
  geometry: GlyphGeometry,
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): string {
  const radius = unitsPerEm * 0.006;
  const strokeWidth = unitsPerEm * 0.0015;
  const fontSize = unitsPerEm * 0.018;
  const anchors = geometry.anchors.map((anchor) => {
    const id = escapeXml(anchor.id);
    const x = svgNumber(anchor.x);
    const y = svgNumber(-anchor.y);
    const color = escapeXml(colors.anchorStroke);
    const label = anchor.name
      ? `<text x="${svgNumber(anchor.x + radius * 1.8)}" y="${svgNumber(-anchor.y - radius * 1.8)}" fill="${color}" font-family="system-ui, sans-serif" font-size="${svgNumber(fontSize)}">${escapeXml(anchor.name)}</text>`
      : "";

    return `<g id="shift-${safeId(anchor.id)}" data-shift-role="anchor" data-shift-id="${id}"><circle cx="${x}" cy="${y}" r="${svgNumber(radius)}" fill="${escapeXml(colors.handleFill)}" stroke="${color}" stroke-width="${svgNumber(strokeWidth)}"/>${label}</g>`;
  });

  return `<g data-shift-role="anchors">${anchors.join("")}</g>`;
}

function renderComponents(
  components: readonly ResolvedComponent[],
  unitsPerEm: number,
  colors: Required<LayerSvgAppearance>,
): string {
  const strokeWidth = unitsPerEm * 0.0015;
  const radius = unitsPerEm * 0.006;
  const stroke = escapeXml(colors.componentStroke);
  const rendered = components
    .filter((component) => component.parentPath.length === 0)
    .map((component) => {
      const bounds = component.bounds;
      if (!bounds) return "";

      const id = escapeXml(component.componentId);
      const width = bounds.max.x - bounds.min.x;
      const height = bounds.max.y - bounds.min.y;
      const originX = component.resolvedTransform.e;
      const originY = -component.resolvedTransform.f;
      return `<g data-shift-role="component" data-shift-id="${id}"><rect x="${svgNumber(bounds.min.x)}" y="${svgNumber(-bounds.max.y)}" width="${svgNumber(width)}" height="${svgNumber(height)}" fill="none" stroke="${stroke}" stroke-width="${svgNumber(strokeWidth)}" stroke-dasharray="${svgNumber(radius)} ${svgNumber(radius)}"/><circle cx="${svgNumber(originX)}" cy="${svgNumber(originY)}" r="${svgNumber(radius)}" fill="${escapeXml(colors.handleFill)}" stroke="${stroke}" stroke-width="${svgNumber(strokeWidth)}"/></g>`;
    })
    .filter(Boolean);

  return rendered.length > 0 ? `<g data-shift-role="components">${rendered.join("")}</g>` : "";
}

function svgNumber(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeId(value: string): string {
  return value.replaceAll(
    /[^A-Za-z0-9_.-]/g,
    (character) => `_${character.codePointAt(0)?.toString(16)}`,
  );
}

import type { HandleState } from "../../../types/graphics";

export interface HandleStyle {
  fill: string;
  stroke: string;
  size: number;
  lineWidth: number;
  overlayColor?: string;
}

export interface FirstHandleStyle extends HandleStyle {
  barSize: number;
  barStroke: string;
}

export type HandleStateStyles<T extends HandleStyle = HandleStyle> = Record<HandleState, T>;

/** The colours of one sign of kern in the Kerning tool. */
export interface KerningPalette {
  /** The translucent strip between the two advance edges. */
  fill: string;
  /** The selected strip's light edge. */
  edge: string;
  /** The value pill, the selected strip's edges, and glyphs a group edit reaches. */
  accent: string;
  accentHover: string;
}

/** The colours of the Spacing tool's gap overlay. */
export interface SpacingPalette {
  /** The half under the pointer: the sidebearing a drag would change. */
  activeFill: string;
  activeHatch: string;
  /** The other half of the gap. */
  idleFill: string;
  idleHatch: string;
  /** The same roles for a negative sidebearing, whose outline overlaps past the boundary. */
  negativeActiveFill: string;
  negativeActiveHatch: string;
  negativeIdleFill: string;
  negativeIdleHatch: string;
  negativeLabelFill: string;
  negativeLabelHoverFill: string;
  hatchGapPx: number;
  /** The active sidebearing's value, in a pill centred in its half. */
  labelFill: string;
  labelHoverFill: string;
  labelText: string;
  labelFont: string;
}

export interface EditorRenderTheme {
  cursor: { color: string; widthPx: number };
  guides: { color: string; widthPx: number };
  selection: { fill: string; stroke: string; widthPx: number };
  glyph: { fill: string; editableFill: string; stroke: string; widthPx: number };
  component: {
    fill: string;
    widthPx: number;
    hoverOutline: { stroke: string; widthPx: number };
  };
  controlLine: { color: string; widthPx: number };
  /** Neutral circular halo behind idle and hovered on-curve points resting exactly on a metric line. */
  metricMarker: { haloFill: string; haloRadiusPx: number };
  handle: {
    corner: HandleStateStyles;
    smooth: HandleStateStyles;
    control: HandleStateStyles;
    anchor: HandleStateStyles;
    direction: HandleStateStyles;
    first: HandleStateStyles<FirstHandleStyle>;
    last: HandleStateStyles;
  };
  snap: { color: string; widthPx: number; crossSizePx: number };
  segment: {
    hoverColor: string;
    selectedColor: string;
    hoverWidthPx: number;
    selectedWidthPx: number;
  };
  preview: { color: string; widthPx: number };
  variationOutline: { color: string; widthPx: number };
  /** Pre-gesture outline drawn under the live outline while a local edit is in progress. */
  editGhost: { color: string; widthPx: number };
  readOnlyLock: { color: string };
  penReady: { fill: string; stroke: string; size: number; widthPx: number };
  debug: {
    tightBounds: string;
    hitRadii: string;
    segmentBounds: string;
    glyphBbox: string;
  };
  textRun: {
    cursorColor: string;
    cursorWidthPx: number;
    selectionFill: string;
    hoverOutline: string;
    hoverOutlineWidthPx: number;
    compositeArmFill: string;
    componentOverlay: readonly [string, string];
    componentOverlayHover: readonly [string, string];
  };
  /** The Spacing tool's gap between two glyphs at an authored source. */
  spacing: SpacingPalette;
  /** The same gap at an interpolated location, where nothing is editable. */
  spacingInterpolated: SpacingPalette;
  /** The Kerning tool's kern between two glyphs: one palette for a tightening kern, one for a loosening one. */
  kerning: {
    negative: KerningPalette;
    positive: KerningPalette;
    /** Any kern at an interpolated location, where nothing is editable. */
    interpolated: KerningPalette;
  };
}

const hover = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

const INTERPOLATED_GREY = "#8A8A8A";

const DEFAULT_EDITOR_RENDER_THEME: EditorRenderTheme = {
  cursor: { color: "#0C92F4", widthPx: 1.25 },
  guides: { color: "rgba(37, 99, 235, 0.50)", widthPx: 0.5 },
  selection: {
    fill: "rgba(59, 130, 246, 0.1)",
    stroke: "rgba(59, 130, 246, 0.5)",
    widthPx: 0.5,
  },
  glyph: {
    fill: "#000000",
    editableFill: "rgba(225, 225, 225, 0.20)",
    stroke: "#000000",
    widthPx: 0.75,
  },
  component: {
    fill: "rgba(231, 231, 231, 0.75)",
    widthPx: 1,
    hoverOutline: { stroke: "#1886D7", widthPx: 1.5 },
  },
  controlLine: { color: "rgba(136, 136, 136, 0.65)", widthPx: 0.75 },
  metricMarker: {
    haloFill: "rgba(0, 0, 0, 0.1)",
    haloRadiusPx: 8,
  },
  handle: {
    corner: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 6, lineWidth: 0.5 },
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 0.5 },
      hovered: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 6,
        lineWidth: 0.75,
        overlayColor: hover(0.1),
      },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 7, lineWidth: 1 },
    },
    smooth: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 2.5, lineWidth: 2 },
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 2.5, lineWidth: 2 },
      hovered: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 2.5,
        lineWidth: 2,
        overlayColor: hover(0.1),
      },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 3, lineWidth: 4 },
    },
    control: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 2, lineWidth: 2 },
      idle: { fill: "#ffffff", stroke: "#B0B0B0", size: 2, lineWidth: 2 },
      hovered: {
        fill: "#ffffff",
        stroke: "#B0B0B0",
        size: 2.5,
        lineWidth: 3,
        overlayColor: hover(0.1),
      },
      selected: { fill: "#B0B0B0", stroke: "#ffffff", size: 2.5, lineWidth: 3 },
    },
    anchor: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 6, lineWidth: 1 },
      idle: { fill: "#ffffff", stroke: "#6B15EC", size: 6, lineWidth: 2 },
      hovered: {
        fill: "#ffffff",
        stroke: "#6B15EC",
        size: 6,
        lineWidth: 3,
        overlayColor: hover(0.1),
      },
      selected: { fill: "#6B15EC", stroke: "#ffffff", size: 6, lineWidth: 3 },
    },
    direction: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 6, lineWidth: 0.5 },
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 0.5 },
      hovered: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 6,
        lineWidth: 1,
        overlayColor: hover(0.1),
      },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 7, lineWidth: 1 },
    },
    first: {
      interpolated: {
        fill: "#ffffff",
        stroke: "rgba(0, 0, 0, 0.65)",
        size: 6,
        lineWidth: 0.5,
        barSize: 18,
        barStroke: "rgba(0, 0, 0, 0.65)",
      },
      idle: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 6,
        lineWidth: 0.5,
        barSize: 18,
        barStroke: "#0C92F4",
      },
      hovered: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 6,
        lineWidth: 1,
        barSize: 18,
        barStroke: "#0C92F4",
        overlayColor: hover(0.3),
      },
      selected: {
        fill: "#0C92F4",
        stroke: "#ffffff",
        size: 6,
        lineWidth: 1,
        barSize: 18,
        barStroke: "#0C92F4",
      },
    },
    last: {
      interpolated: { fill: "#ffffff", stroke: "rgba(0, 0, 0, 0.65)", size: 12, lineWidth: 0.5 },
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 12, lineWidth: 0.5 },
      hovered: {
        fill: "#ffffff",
        stroke: "#0C92F4",
        size: 12,
        lineWidth: 1,
        overlayColor: hover(0.5),
      },
      selected: { fill: "#ffffff", stroke: "#0C92F4", size: 12, lineWidth: 2 },
    },
  },
  snap: { color: "#ff3b30", widthPx: 0.5, crossSizePx: 2 },
  segment: {
    hoverColor: "#1886D7",
    selectedColor: "#1886D7",
    hoverWidthPx: 1.5,
    selectedWidthPx: 1.75,
  },
  preview: { color: "#1886D7", widthPx: 1 },
  variationOutline: { color: "rgba(12, 146, 244, 0.45)", widthPx: 1 },
  editGhost: { color: "rgba(0, 0, 0, 0.12)", widthPx: 1 },
  readOnlyLock: { color: "#171717" },
  penReady: { fill: "#ffffff", stroke: "#3b82f6", size: 3, widthPx: 2 },
  debug: {
    tightBounds: "red",
    hitRadii: "#2196F3",
    segmentBounds: "#FF9800",
    glyphBbox: "#FF00FB",
  },
  textRun: {
    cursorColor: "#0C92F4",
    cursorWidthPx: 1.25,
    selectionFill: "rgba(12, 146, 244, 0.2)",
    hoverOutline: "#0C92F4",
    hoverOutlineWidthPx: 3,
    compositeArmFill: "rgba(128, 128, 128, 0.22)",
    componentOverlay: ["rgba(169, 236, 183, 0.26)", "rgba(255, 182, 207, 0.26)"],
    componentOverlayHover: ["rgba(124, 220, 150, 0.4)", "rgba(255, 151, 186, 0.4)"],
  },
  spacing: {
    activeFill: "rgba(219, 46, 145, 0.14)",
    activeHatch: "rgba(219, 46, 145, 0.75)",
    idleFill: "rgba(219, 46, 145, 0.05)",
    idleHatch: "rgba(219, 46, 145, 0.45)",
    negativeActiveFill: "rgba(217, 119, 6, 0.16)",
    negativeActiveHatch: "rgba(217, 119, 6, 0.85)",
    negativeIdleFill: "rgba(217, 119, 6, 0.05)",
    negativeIdleHatch: "rgba(217, 119, 6, 0.5)",
    negativeLabelFill: "#D97706",
    negativeLabelHoverFill: "rgba(217, 119, 6, 0.8)",
    hatchGapPx: 6,
    labelFill: "#DB2E91",
    labelHoverFill: "rgba(219, 46, 145, 0.8)",
    labelText: "#ffffff",
    labelFont: "500 10px Inter, system-ui, sans-serif",
  },
  spacingInterpolated: spacingPalette(INTERPOLATED_GREY, INTERPOLATED_GREY, {
    idleHatch: "rgba(138, 138, 138, 0.45)",
    negativeIdleHatch: "rgba(138, 138, 138, 0.5)",
  }),
  kerning: {
    interpolated: kerningPalette(INTERPOLATED_GREY),
    negative: {
      fill: "rgba(124, 58, 237, 0.12)",
      edge: "rgba(124, 58, 237, 0.45)",
      accent: "#7C3AED",
      accentHover: "rgba(124, 58, 237, 0.8)",
    },
    positive: {
      fill: "rgba(13, 148, 136, 0.12)",
      edge: "rgba(13, 148, 136, 0.45)",
      accent: "#0D9488",
      accentHover: "rgba(13, 148, 136, 0.8)",
    },
  },
};

/** Reads the active editor palette from CSS and combines it with renderer-owned geometry. */
export function readEditorRenderTheme(
  root: Element | null = typeof document === "undefined" ? null : document.documentElement,
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> | null = root &&
  typeof getComputedStyle !== "undefined"
    ? getComputedStyle(root)
    : null,
): EditorRenderTheme {
  const theme = structuredClone(DEFAULT_EDITOR_RENDER_THEME);
  const readColor = (name: string, fallback: string) =>
    style?.getPropertyValue(name).trim() || fallback;

  theme.cursor.color = readColor("--editor-cursor-color", theme.cursor.color);
  theme.guides.color = readColor("--editor-guides-color", theme.guides.color);
  theme.selection.fill = readColor("--editor-selection-fill", theme.selection.fill);
  theme.selection.stroke = readColor("--editor-selection-stroke", theme.selection.stroke);
  theme.glyph.fill = readColor("--editor-glyph-fill", theme.glyph.fill);
  theme.glyph.editableFill = readColor("--editor-glyph-editable-fill", theme.glyph.editableFill);
  theme.glyph.stroke = readColor("--editor-glyph-stroke", theme.glyph.stroke);
  theme.component.fill = readColor("--editor-component-fill", theme.component.fill);
  theme.component.hoverOutline.stroke = readColor(
    "--editor-component-hover-outline",
    theme.component.hoverOutline.stroke,
  );
  theme.controlLine.color = readColor("--editor-control-line-color", theme.controlLine.color);
  theme.metricMarker.haloFill = readColor(
    "--editor-metric-marker-fill",
    theme.metricMarker.haloFill,
  );

  const handleFill = readColor("--editor-handle-fill", theme.handle.corner.idle.fill);
  const interpolatedStroke = readColor(
    "--editor-handle-interpolated-stroke",
    theme.handle.corner.interpolated.stroke,
  );
  const primaryStroke = readColor(
    "--editor-handle-primary-stroke",
    theme.handle.corner.idle.stroke,
  );
  const controlStroke = readColor(
    "--editor-handle-control-stroke",
    theme.handle.control.idle.stroke,
  );
  const anchorStroke = readColor("--editor-handle-anchor-stroke", theme.handle.anchor.idle.stroke);
  const subtleOverlay = readColor(
    "--editor-handle-overlay-subtle",
    theme.handle.corner.hovered.overlayColor ?? "transparent",
  );

  for (const shape of [
    "corner",
    "smooth",
    "control",
    "anchor",
    "direction",
    "first",
    "last",
  ] as const) {
    theme.handle[shape].interpolated.fill = handleFill;
    theme.handle[shape].interpolated.stroke = interpolatedStroke;
    theme.handle[shape].idle.fill = handleFill;
    theme.handle[shape].hovered.fill = handleFill;
  }

  for (const shape of ["corner", "smooth", "direction"] as const) {
    theme.handle[shape].idle.stroke = primaryStroke;
    theme.handle[shape].hovered.stroke = primaryStroke;
    theme.handle[shape].hovered.overlayColor = subtleOverlay;
    theme.handle[shape].selected.fill = primaryStroke;
    theme.handle[shape].selected.stroke = handleFill;
  }

  theme.handle.control.idle.stroke = controlStroke;
  theme.handle.control.hovered.stroke = controlStroke;
  theme.handle.control.hovered.overlayColor = subtleOverlay;
  theme.handle.control.selected.fill = controlStroke;
  theme.handle.control.selected.stroke = handleFill;

  theme.handle.anchor.idle.stroke = anchorStroke;
  theme.handle.anchor.hovered.stroke = anchorStroke;
  theme.handle.anchor.hovered.overlayColor = readColor(
    "--editor-handle-overlay-anchor",
    theme.handle.anchor.hovered.overlayColor ?? "transparent",
  );
  theme.handle.anchor.selected.fill = anchorStroke;
  theme.handle.anchor.selected.stroke = handleFill;

  theme.handle.first.idle.stroke = primaryStroke;
  theme.handle.first.idle.barStroke = primaryStroke;
  theme.handle.first.hovered.stroke = primaryStroke;
  theme.handle.first.hovered.barStroke = primaryStroke;
  theme.handle.first.hovered.overlayColor = readColor(
    "--editor-handle-overlay-first",
    theme.handle.first.hovered.overlayColor ?? "transparent",
  );
  theme.handle.first.selected.fill = primaryStroke;
  theme.handle.first.selected.stroke = handleFill;
  theme.handle.first.selected.barStroke = primaryStroke;
  theme.handle.first.interpolated.barStroke = interpolatedStroke;

  theme.handle.last.idle.stroke = primaryStroke;
  theme.handle.last.hovered.stroke = primaryStroke;
  theme.handle.last.hovered.overlayColor = readColor(
    "--editor-handle-overlay-last",
    theme.handle.last.hovered.overlayColor ?? "transparent",
  );
  theme.handle.last.selected.fill = handleFill;
  theme.handle.last.selected.stroke = primaryStroke;

  theme.snap.color = readColor("--editor-snap-color", theme.snap.color);
  theme.segment.hoverColor = readColor("--editor-segment-hover-color", theme.segment.hoverColor);
  theme.segment.selectedColor = readColor(
    "--editor-segment-selected-color",
    theme.segment.selectedColor,
  );
  theme.preview.color = readColor("--editor-preview-color", theme.preview.color);
  theme.variationOutline.color = readColor(
    "--editor-variation-outline-color",
    theme.variationOutline.color,
  );
  theme.editGhost.color = readColor("--editor-edit-ghost-color", theme.editGhost.color);
  theme.readOnlyLock.color = readColor("--editor-read-only-lock-color", theme.readOnlyLock.color);
  theme.penReady.fill = readColor("--editor-pen-ready-fill", theme.penReady.fill);
  theme.penReady.stroke = readColor("--editor-pen-ready-stroke", theme.penReady.stroke);

  theme.debug.tightBounds = readColor("--editor-debug-tight-bounds", theme.debug.tightBounds);
  theme.debug.hitRadii = readColor("--editor-debug-hit-radii", theme.debug.hitRadii);
  theme.debug.segmentBounds = readColor("--editor-debug-segment-bounds", theme.debug.segmentBounds);
  theme.debug.glyphBbox = readColor("--editor-debug-glyph-bbox", theme.debug.glyphBbox);

  theme.textRun.cursorColor = readColor("--editor-text-cursor-color", theme.textRun.cursorColor);
  theme.textRun.selectionFill = readColor(
    "--editor-text-selection-fill",
    theme.textRun.selectionFill,
  );
  theme.textRun.hoverOutline = readColor("--editor-text-hover-outline", theme.textRun.hoverOutline);
  theme.textRun.compositeArmFill = readColor(
    "--editor-text-composite-arm-fill",
    theme.textRun.compositeArmFill,
  );
  theme.textRun.componentOverlay = [
    readColor("--editor-text-component-overlay-a", theme.textRun.componentOverlay[0]),
    readColor("--editor-text-component-overlay-b", theme.textRun.componentOverlay[1]),
  ];
  theme.textRun.componentOverlayHover = [
    readColor("--editor-text-component-overlay-hover-a", theme.textRun.componentOverlayHover[0]),
    readColor("--editor-text-component-overlay-hover-b", theme.textRun.componentOverlayHover[1]),
  ];

  const spacing = readColor("--editor-spacing", theme.spacing.labelFill);
  const negative = readColor("--editor-spacing-negative", theme.spacing.negativeLabelFill);
  theme.spacing = spacingPalette(spacing, negative, {
    idleHatch: readColor("--editor-spacing-faint", theme.spacing.idleHatch),
    negativeIdleHatch: readColor(
      "--editor-spacing-negative-faint",
      theme.spacing.negativeIdleHatch,
    ),
  });
  const interpolated = readColor("--editor-interpolated", INTERPOLATED_GREY);
  theme.spacingInterpolated = spacingPalette(interpolated, interpolated, {
    idleHatch: withAlpha(interpolated, 0.45),
    negativeIdleHatch: withAlpha(interpolated, 0.5),
  });

  theme.kerning = {
    negative: kerningPalette(readColor("--editor-kerning", theme.kerning.negative.accent)),
    positive: kerningPalette(readColor("--editor-kerning-positive", theme.kerning.positive.accent)),
    interpolated: kerningPalette(interpolated),
  };

  return theme;
}

/** The kerning overlay's colours derived from one `#rrggbb` accent. */
function kerningPalette(accent: string): KerningPalette {
  return {
    fill: withAlpha(accent, 0.12),
    edge: withAlpha(accent, 0.45),
    accent,
    accentHover: withAlpha(accent, 0.8),
  };
}

/** The spacing overlay's colours derived from a positive and a negative `#rrggbb` accent. */
function spacingPalette(
  positive: string,
  negative: string,
  faint: { readonly idleHatch: string; readonly negativeIdleHatch: string },
): SpacingPalette {
  return {
    activeFill: withAlpha(positive, 0.14),
    activeHatch: withAlpha(positive, 0.75),
    idleFill: withAlpha(positive, 0.05),
    idleHatch: faint.idleHatch,
    labelFill: positive,
    labelHoverFill: withAlpha(positive, 0.8),
    negativeActiveFill: withAlpha(negative, 0.16),
    negativeActiveHatch: withAlpha(negative, 0.85),
    negativeIdleFill: withAlpha(negative, 0.05),
    negativeIdleHatch: faint.negativeIdleHatch,
    negativeLabelFill: negative,
    negativeLabelHoverFill: withAlpha(negative, 0.8),
    hatchGapPx: 6,
    labelText: "#ffffff",
    labelFont: "500 10px Inter, system-ui, sans-serif",
  };
}

/** Returns a `#rrggbb` colour at `alpha`; other colour syntaxes are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = match.slice(1).map((channel) => Number.parseInt(channel, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

import type { HandleState } from "@/types/graphics";

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

export interface Theme {
  cursor: { color: string; widthPx: number };
  guides: { color: string; widthPx: number };
  selection: { fill: string; stroke: string; widthPx: number };
  boundingBox: {
    stroke: string;
    widthPx: number;
    dash: number[];
    handle: { radius: number; offset: number; stroke: string; widthPx: number };
    rotationZoneOffset: number;
  };
  glyph: { fill: string; stroke: string; widthPx: number };
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
  segment: { hoverColor: string; selectedColor: string; hoverWidthPx: number; selectedWidthPx: number };
  preview: { color: string; widthPx: number };
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
}

const hover = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

export const DEFAULT_THEME: Theme = {
  cursor: { color: "#0C92F4", widthPx: 1.25 },
  guides: { color: "#6366f1", widthPx: 0.5 },
  selection: { fill: "rgba(59, 130, 246, 0.04)", stroke: "#3b82f6", widthPx: 1 },
  boundingBox: {
    stroke: "#000000",
    widthPx: 1,
    dash: [12, 8],
    handle: { radius: 4, offset: 15, stroke: "#000000", widthPx: 1 },
    rotationZoneOffset: 20,
  },
  glyph: { fill: "#ffffff", stroke: "#171717", widthPx: 0.75 },
  handle: {
    corner: {
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 0.5 },
      hovered: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 1, overlayColor: hover(0.75) },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 8, lineWidth: 2 },
    },
    smooth: {
      idle: { fill: "#ffffff", stroke: "#03D211", size: 2.5, lineWidth: 3 },
      hovered: { fill: "#ffffff", stroke: "#03D211", size: 3, lineWidth: 3, overlayColor: hover(0.5) },
      selected: { fill: "#03D211", stroke: "#ffffff", size: 4, lineWidth: 4 },
    },
    control: {
      idle: { fill: "#ffffff", stroke: "#B0B0B0", size: 2.5, lineWidth: 3 },
      hovered: { fill: "#ffffff", stroke: "#B0B0B0", size: 3, lineWidth: 3, overlayColor: hover(0.5) },
      selected: { fill: "#B0B0B0", stroke: "#ffffff", size: 4, lineWidth: 4 },
    },
    anchor: {
      idle: { fill: "#ffffff", stroke: "#6B15EC", size: 6, lineWidth: 1 },
      hovered: { fill: "#ffffff", stroke: "#6B15EC", size: 6, lineWidth: 1, overlayColor: hover(0.75) },
      selected: { fill: "#6B15EC", stroke: "#ffffff", size: 8, lineWidth: 2 },
    },
    direction: {
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 1 },
      hovered: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 1, overlayColor: hover(0.5) },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 8, lineWidth: 2 },
    },
    first: {
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 0.5, barSize: 18, barStroke: "#0C92F4" },
      hovered: { fill: "#ffffff", stroke: "#0C92F4", size: 6, lineWidth: 1, barSize: 18, barStroke: "#0C92F4", overlayColor: hover(0.75) },
      selected: { fill: "#0C92F4", stroke: "#ffffff", size: 8, lineWidth: 1, barSize: 20, barStroke: "#0C92F4" },
    },
    last: {
      idle: { fill: "#ffffff", stroke: "#0C92F4", size: 12, lineWidth: 0.5 },
      hovered: { fill: "#ffffff", stroke: "#0C92F4", size: 12, lineWidth: 1, overlayColor: hover(0.5) },
      selected: { fill: "#ffffff", stroke: "#0C92F4", size: 14, lineWidth: 2 },
    },
  },
  snap: { color: "#ff3b30", widthPx: 1, crossSizePx: 2 },
  segment: { hoverColor: "#1886D7", selectedColor: "#1886D7", hoverWidthPx: 1, selectedWidthPx: 1.5 },
  preview: { color: "#1886D7", widthPx: 1 },
  penReady: { fill: "#ffffff", stroke: "#3b82f6", size: 3, widthPx: 1 },
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
};

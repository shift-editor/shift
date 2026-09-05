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
  glyph: { fill: string; editableFill: string; stroke: string; widthPx: number };
  component: { fill: string; widthPx: number };
  controlLine: { color: string; widthPx: number };
  handle: {
    corner: HandleStateStyles;
    smooth: HandleStateStyles;
    control: HandleStateStyles;
    anchor: HandleStateStyles;
    direction: HandleStateStyles;
    first: HandleStateStyles<FirstHandleStyle>;
    last: HandleStateStyles;
  };
  segment: {
    hoverColor: string;
    selectedColor: string;
    hoverWidthPx: number;
    selectedWidthPx: number;
  };
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
  component: { fill: "rgba(231, 231, 231, 0.75)", widthPx: 1 },
  controlLine: { color: "rgba(136, 136, 136, 0.65)", widthPx: 0.75 },
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
      idle: { fill: "#ffffff", stroke: "#6B15EC", size: 6, lineWidth: 1 },
      hovered: {
        fill: "#ffffff",
        stroke: "#6B15EC",
        size: 6,
        lineWidth: 1,
        overlayColor: hover(0.75),
      },
      selected: { fill: "#6B15EC", stroke: "#ffffff", size: 6, lineWidth: 2 },
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
  segment: {
    hoverColor: "#1886D7",
    selectedColor: "#1886D7",
    hoverWidthPx: 1.5,
    selectedWidthPx: 1.75,
  },
  preview: { color: "#1886D7", widthPx: 1 },
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
};

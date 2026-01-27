import type { HandleType } from "@/lib/editor/rendering/handles";
import { ThemeTokens } from "../theme";

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
  dashPattern: number[];
}

export interface HandleDimensions {
  size: number;
}

type HandleStyle = DrawStyle &
  HandleDimensions & {
    overlayColor?: string;
  };

export interface HandleStyles {
  idle: HandleStyle;
  hovered: HandleStyle;
  selected: HandleStyle;
}

export function createHandleStyles(
  theme: ThemeTokens,
): Record<HandleType, HandleStyles> {
  const { cyan, gray, green, pink } = theme.canvas;
  const white = theme.ui.bg.surface;
  const hoverOverlay = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

  return {
    first: {
      idle: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.75),
      },
      selected: {
        size: 8,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
    },
    corner: {
      idle: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: pink,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: pink,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.75),
      },
      selected: {
        size: 8,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: white,
        fillStyle: pink,
        dashPattern: [],
      },
    },
    control: {
      idle: {
        size: 3,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: gray,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 3,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: gray,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.5),
      },
      selected: {
        size: 4,
        lineWidth: 4,
        antiAlias: false,
        strokeStyle: white,
        fillStyle: gray,
        dashPattern: [],
      },
    },
    smooth: {
      idle: {
        size: 3,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 3,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.5),
      },
      selected: {
        size: 4,
        lineWidth: 4,
        antiAlias: false,
        strokeStyle: white,
        fillStyle: green,
        dashPattern: [],
      },
    },
    direction: {
      idle: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.5),
      },
      selected: {
        size: 8,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: white,
        fillStyle: cyan,
        dashPattern: [],
      },
    },
    last: {
      idle: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 6,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.5),
      },
      selected: {
        size: 7,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
    },
  };
}

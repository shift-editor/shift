import { ThemeTokens } from "../theme";

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
  dashPattern: number[];
}

export interface BaseHandleStyle extends DrawStyle {
  size: number;
  overlayColor?: string;
}

interface FirstHandleStyle extends BaseHandleStyle {
  barSize: number;
  barStrokeStyle: string;
}

export interface HandleStyles<T extends BaseHandleStyle = BaseHandleStyle> {
  idle: T;
  hovered: T;
  selected: T;
}

export type HandleStylesMap = {
  first: HandleStyles<FirstHandleStyle>;
  corner: HandleStyles;
  control: HandleStyles;
  smooth: HandleStyles;
  direction: HandleStyles;
  last: HandleStyles;
};

export function createHandleStyles(theme: ThemeTokens): HandleStylesMap {
  const { cyan, gray, green } = theme.canvas;
  const white = theme.ui.bg.surface;
  const hoverOverlay = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

  return {
    first: {
      idle: {
        size: 6,
        barSize: 18,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        barStrokeStyle: cyan,
        dashPattern: [],
      },
      hovered: {
        size: 6,
        barSize: 18,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        barStrokeStyle: cyan,
        dashPattern: [],
        overlayColor: hoverOverlay(0.75),
      },
      selected: {
        size: 8,
        barSize: 20,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: white,
        fillStyle: cyan,
        barStrokeStyle: cyan,
        dashPattern: [],
      },
    },
    corner: {
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
        strokeStyle: white,
        fillStyle: cyan,
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
        size: 12,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 12,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
        overlayColor: hoverOverlay(0.5),
      },
      selected: {
        size: 14,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
    },
  };
}

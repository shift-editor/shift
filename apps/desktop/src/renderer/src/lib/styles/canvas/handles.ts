import { HandleType } from "@/types/handle";
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

type HandleStyle = DrawStyle & HandleDimensions;

export interface HandleStyles {
  idle: HandleStyle;
  hovered: HandleStyle;
  selected: HandleStyle;
}

export function createHandleStyles(
  theme: ThemeTokens,
): Record<HandleType, HandleStyles> {
  const { cyan, gray, green } = theme.canvas;
  const white = theme.ui.bg.surface;

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
        size: 7,
        lineWidth: 1.5,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
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
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 7,
        lineWidth: 1.5,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
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
        size: 4,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: gray,
        fillStyle: white,
        dashPattern: [],
      },
      selected: {
        size: 5,
        lineWidth: 3,
        antiAlias: false,
        strokeStyle: gray,
        fillStyle: white,
        dashPattern: [],
      },
    },
    smooth: {
      idle: {
        size: 4,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: white,
        dashPattern: [],
      },
      hovered: {
        size: 5,
        lineWidth: 1.5,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: white,
        dashPattern: [],
      },
      selected: {
        size: 6,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: white,
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
        size: 7,
        lineWidth: 1.5,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
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
        size: 7,
        lineWidth: 1.5,
        antiAlias: false,
        strokeStyle: cyan,
        fillStyle: white,
        dashPattern: [],
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
  };
}

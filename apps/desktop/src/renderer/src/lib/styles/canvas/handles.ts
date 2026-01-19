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
  const { purple, orange, green, indigo } = theme.canvas;

  return {
    first: {
      idle: {
        size: 3,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
      hovered: {
        size: 3.5,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
      selected: {
        size: 5,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
    },
    corner: {
      idle: {
        size: 6,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: "transparent",
        dashPattern: [],
      },
      hovered: {
        size: 8,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: "transparent",
        dashPattern: [],
      },
      selected: {
        size: 12,
        lineWidth: 1,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
    },
    control: {
      idle: {
        size: 1.5,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: orange,
        fillStyle: theme.ui.bg.surface,
        dashPattern: [],
      },
      hovered: {
        size: 3,
        lineWidth: 2,
        strokeStyle: orange,
        fillStyle: orange,
        antiAlias: true,
        dashPattern: [],
      },
      selected: {
        size: 4,
        lineWidth: 1,
        strokeStyle: orange,
        fillStyle: orange,
        antiAlias: true,
        dashPattern: [],
      },
    },
    smooth: {
      idle: {
        size: 3,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: green,
        dashPattern: [],
      },
      hovered: {
        size: 3.5,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: green,
        dashPattern: [],
      },
      selected: {
        size: 5,
        lineWidth: 2,
        antiAlias: false,
        strokeStyle: green,
        fillStyle: green,
        dashPattern: [],
      },
    },
    direction: {
      idle: {
        size: 7,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: indigo,
        fillStyle: theme.ui.text.primary,
        dashPattern: [],
      },
      hovered: {
        size: 8,
        lineWidth: 1,
        strokeStyle: indigo,
        fillStyle: indigo,
        dashPattern: [],
      },
      selected: {
        size: 9,
        lineWidth: 1,
        strokeStyle: indigo,
        fillStyle: indigo,
        dashPattern: [],
      },
    },
    last: {
      idle: {
        size: 6,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
      hovered: {
        size: 8,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
      selected: {
        size: 10,
        lineWidth: 0.75,
        antiAlias: false,
        strokeStyle: purple,
        fillStyle: purple,
        dashPattern: [],
      },
    },
  };
}

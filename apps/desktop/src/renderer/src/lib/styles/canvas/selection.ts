import { ThemeTokens } from "../theme";
import { DrawStyle } from "./handles";

export function createSelectionRectangleStyles(theme: ThemeTokens): DrawStyle {
  const blueWithAlpha = theme.canvas.blue + "0a";
  return {
    lineWidth: 1,
    strokeStyle: theme.canvas.blue,
    fillStyle: blueWithAlpha,
    antiAlias: false,
    dashPattern: [],
  };
}

export function createBoundingRectangleStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 0.5,
    strokeStyle: theme.ui.text.secondary,
    fillStyle: "transparent",
    antiAlias: false,
    dashPattern: [5, 5],
  };
}

export function createSegmentHoverStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 2,
    strokeStyle: theme.canvas.cyan,
    fillStyle: "transparent",
    antiAlias: true,
    dashPattern: [],
  };
}

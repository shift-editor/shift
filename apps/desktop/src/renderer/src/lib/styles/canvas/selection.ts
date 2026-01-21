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
    lineWidth: 1,
    strokeStyle: theme.canvas.indicator,
    fillStyle: "transparent",
    antiAlias: true,
    dashPattern: [],
  };
}

export function createSegmentSelectedStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 1.5,
    strokeStyle: theme.canvas.indicator,
    fillStyle: "transparent",
    antiAlias: true,
    dashPattern: [],
  };
}

export function createPreviewLineStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 1,
    strokeStyle: theme.canvas.indicator,
    fillStyle: "transparent",
    antiAlias: true,
    dashPattern: [],
  };
}

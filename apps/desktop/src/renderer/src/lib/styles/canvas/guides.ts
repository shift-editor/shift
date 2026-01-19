import { ThemeTokens } from "../theme";
import { DrawStyle } from "./handles";

export function createGuideStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 0.5,
    strokeStyle: theme.canvas.indigo,
    fillStyle: theme.ui.text.primary,
    antiAlias: false,
    dashPattern: [],
  };
}

export function createDefaultStyles(theme: ThemeTokens): DrawStyle {
  return {
    lineWidth: 0.75,
    strokeStyle: theme.ui.text.primary,
    fillStyle: theme.ui.bg.surface,
    antiAlias: false,
    dashPattern: [],
  };
}

import { ThemeTokens } from "../theme";
import { BaseHandleStyle } from "./handles";

export function createPenReadyStyles(theme: ThemeTokens): BaseHandleStyle {
  return {
    size: 3,
    lineWidth: 1,
    strokeStyle: theme.canvas.blue,
    fillStyle: theme.canvas.white,
    antiAlias: false,
    dashPattern: [],
  };
}

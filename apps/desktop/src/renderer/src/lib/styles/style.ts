import { lightTheme } from "./theme";
import { getCanvasStyles, DrawStyle, HandleStyles } from "./canvas";

export type { DrawStyle, HandleStyles };

export interface HandleDimensions {
  size: number;
}

const defaultCanvasStyles = getCanvasStyles(lightTheme);

export const GUIDE_STYLES: DrawStyle = defaultCanvasStyles.guides;
export const DEFAULT_STYLES: DrawStyle = defaultCanvasStyles.default;
export const HANDLE_STYLES = defaultCanvasStyles.handles;
export const SELECTION_RECTANGLE_STYLES: DrawStyle =
  defaultCanvasStyles.selectionRectangle;
export const BOUNDING_RECTANGLE_STYLES: DrawStyle =
  defaultCanvasStyles.boundingRectangle;
export const SEGMENT_HOVER_STYLE: DrawStyle = defaultCanvasStyles.segmentHover;
export const SEGMENT_SELECTED_STYLE: DrawStyle =
  defaultCanvasStyles.segmentSelected;
export const PREVIEW_LINE_STYLE: DrawStyle = defaultCanvasStyles.previewLine;

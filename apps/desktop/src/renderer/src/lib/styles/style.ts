import { lightTheme } from "./theme";
import { getCanvasStyles, DrawStyle, HandleStyles, HandleStylesMap } from "./canvas";
import type { BoundingBoxHandleStyles } from "./canvas/boundingBox";
import { BaseHandleStyle } from "./canvas/handles";

export type { DrawStyle, HandleStyles, HandleStylesMap, BoundingBoxHandleStyles };

export interface HandleDimensions {
  size: number;
}

const defaultCanvasStyles = getCanvasStyles(lightTheme);

export const GUIDE_STYLES: DrawStyle = defaultCanvasStyles.guides;
export const DEFAULT_STYLES: DrawStyle = defaultCanvasStyles.default;
export const HANDLE_STYLES: HandleStylesMap = defaultCanvasStyles.handles;
export const SELECTION_RECTANGLE_STYLES: DrawStyle = defaultCanvasStyles.selectionRectangle;
export const BOUNDING_RECTANGLE_STYLES: DrawStyle = defaultCanvasStyles.boundingRectangle;
export const SEGMENT_HOVER_STYLE: DrawStyle = defaultCanvasStyles.segmentHover;
export const SEGMENT_SELECTED_STYLE: DrawStyle = defaultCanvasStyles.segmentSelected;
export const PREVIEW_LINE_STYLE: DrawStyle = defaultCanvasStyles.previewLine;
export const BOUNDING_BOX_HANDLE_STYLES: BoundingBoxHandleStyles =
  defaultCanvasStyles.boundingBoxHandles;
export const PEN_READY_STYLE: BaseHandleStyle = defaultCanvasStyles.penReady;

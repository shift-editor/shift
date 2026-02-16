import { lightTheme } from "./theme";
import { getCanvasStyles, resolveDrawStyle } from "./canvas";
import type { DrawStyle, HandleStyles, HandleStylesMap, ResolvedDrawStyle } from "./canvas";
import type { BoundingBoxHandleStyles } from "./canvas/boundingBox";
import type { BaseHandleStyle } from "./canvas/handles";

export type {
  DrawStyle,
  HandleStyles,
  HandleStylesMap,
  BoundingBoxHandleStyles,
  ResolvedDrawStyle,
};
export { resolveDrawStyle };

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
export const SNAP_INDICATOR_STYLE: DrawStyle = {
  strokeStyle: "#ff3b30",
  fillStyle: "transparent",
  lineWidth: 1,
  dashPattern: [],
};
export const SNAP_INDICATOR_CROSS_SIZE_PX = 2;
export const BOUNDING_BOX_HANDLE_STYLES: BoundingBoxHandleStyles =
  defaultCanvasStyles.boundingBoxHandles;
export const PEN_READY_STYLE: BaseHandleStyle = defaultCanvasStyles.penReady;

import { ThemeTokens } from "../theme";
import { createHandleStyles, DrawStyle, HandleStylesMap } from "./handles";
import { createGuideStyles, createDefaultStyles } from "./guides";
import {
  createSelectionRectangleStyles,
  createBoundingRectangleStyles,
  createSegmentHoverStyles,
  createSegmentSelectedStyles,
  createPreviewLineStyles,
} from "./selection";
import { createBoundingBoxHandleStyles, BoundingBoxHandleStyles } from "./boundingBox";

export interface CanvasStyles {
  handles: HandleStylesMap;
  guides: DrawStyle;
  default: DrawStyle;
  selectionRectangle: DrawStyle;
  boundingRectangle: DrawStyle;
  segmentHover: DrawStyle;
  segmentSelected: DrawStyle;
  previewLine: DrawStyle;
  boundingBoxHandles: BoundingBoxHandleStyles;
}

export function getCanvasStyles(theme: ThemeTokens): CanvasStyles {
  return {
    handles: createHandleStyles(theme),
    guides: createGuideStyles(theme),
    default: createDefaultStyles(theme),
    selectionRectangle: createSelectionRectangleStyles(theme),
    boundingRectangle: createBoundingRectangleStyles(theme),
    segmentHover: createSegmentHoverStyles(theme),
    segmentSelected: createSegmentSelectedStyles(theme),
    previewLine: createPreviewLineStyles(theme),
    boundingBoxHandles: createBoundingBoxHandleStyles(theme),
  };
}

export type { DrawStyle, HandleStyles, HandleStylesMap } from "./handles";

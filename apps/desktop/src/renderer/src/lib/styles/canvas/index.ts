import type { ThemeTokens } from "../theme";
import { createHandleStyles } from "./handles";
import type { BaseHandleStyle, DrawStyle, HandleStylesMap } from "./handles";
import { createGuideStyles, createDefaultStyles } from "./guides";
import { resolveDrawStyle, type ResolvedDrawStyle } from "./resolveDrawStyle";
import {
  createSelectionRectangleStyles,
  createBoundingRectangleStyles,
  createSegmentHoverStyles,
  createSegmentSelectedStyles,
  createPreviewLineStyles,
} from "./selection";
import { createBoundingBoxHandleStyles } from "./boundingBox";
import type { BoundingBoxHandleStyles } from "./boundingBox";
import { createPenReadyStyles } from "./pen";

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
  penReady: BaseHandleStyle;
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
    penReady: createPenReadyStyles(theme),
  };
}

export type { DrawStyle, HandleStyles, HandleStylesMap } from "./handles";
export { resolveDrawStyle };
export type { ResolvedDrawStyle };

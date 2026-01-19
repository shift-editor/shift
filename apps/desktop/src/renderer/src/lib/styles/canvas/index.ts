import { HandleType } from "@/types/handle";
import { ThemeTokens } from "../theme";
import { createHandleStyles, DrawStyle, HandleStyles } from "./handles";
import { createGuideStyles, createDefaultStyles } from "./guides";
import {
  createSelectionRectangleStyles,
  createBoundingRectangleStyles,
  createSegmentHoverStyles,
} from "./selection";

export interface CanvasStyles {
  handles: Record<HandleType, HandleStyles>;
  guides: DrawStyle;
  default: DrawStyle;
  selectionRectangle: DrawStyle;
  boundingRectangle: DrawStyle;
  segmentHover: DrawStyle;
}

export function getCanvasStyles(theme: ThemeTokens): CanvasStyles {
  return {
    handles: createHandleStyles(theme),
    guides: createGuideStyles(theme),
    default: createDefaultStyles(theme),
    selectionRectangle: createSelectionRectangleStyles(theme),
    boundingRectangle: createBoundingRectangleStyles(theme),
    segmentHover: createSegmentHoverStyles(theme),
  };
}

export type { DrawStyle, HandleStyles } from "./handles";

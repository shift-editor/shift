import chroma from "chroma-js";
import { HandleType } from "../../../types/handle";

export enum StrokeStyle {
  Stroke,
  Fill,
}
export interface DrawStyle {
  strokeWidth: number;
  strokeStyle?: StrokeStyle;
  strokeColour: chroma.Color;
  antialias?: boolean;
}

export const DEFAULT_STYLES: DrawStyle = {
  strokeWidth: 1,
  strokeStyle: StrokeStyle.Stroke,
  strokeColour: chroma.rgb(0, 0, 0),
  antialias: true,
};

export const HANDLE_STYLES: Record<HandleType, DrawStyle> = {
  [HandleType.CORNER]: {
    antialias: false,
    strokeWidth: 1,
    strokeColour: chroma.rgb(76, 96, 230),
  },
  [HandleType.SMOOTH]: {
    strokeStyle: StrokeStyle.Fill,
    strokeWidth: 2,
    strokeColour: chroma.rgb(173, 255, 47),
    antialias: false,
  },
  [HandleType.CONTROL]: {
    antialias: true,
    strokeWidth: 1,
    strokeColour: chroma.rgb(230, 76, 96),
  },
  [HandleType.DIRECTION]: {
    antialias: false,
    strokeWidth: 1,
    strokeColour: chroma.rgb(96, 230, 76),
  },
};

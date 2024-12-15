import chroma from "chroma-js";

export interface DrawStyle {
  strokeWidth: number;
  strokeColour: chroma.Color;
  antialias?: boolean;
}

export const DEFAULT_STYLES: DrawStyle = {
  strokeWidth: 1,
  strokeColour: chroma.rgb(0, 0, 0),
  antialias: true,
};

export enum HandleType {
  CORNER,
  CONTROL,
  DIRECTION,
}
export const HANDLE_STYLES: Record<HandleType, DrawStyle> = {
  [HandleType.CORNER]: {
    antialias: false,
    strokeWidth: 1,
    strokeColour: chroma.rgb(76, 96, 230),
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

import { HandleType } from "../../../types/handle";

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
}

export const GUIDE_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: "rgb(76, 96, 230)",
  fillStyle: "black",
  antiAlias: true,
};

export const DEFAULT_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: "black",
  fillStyle: "white",
  antiAlias: true,
};

export const HANDLE_STYLES: Record<HandleType, DrawStyle> = {
  [HandleType.CORNER]: {
    antiAlias: false,
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "white",
  },
  [HandleType.SMOOTH]: {
    strokeStyle: "green",
    lineWidth: 2,
    fillStyle: "white",
    antiAlias: false,
  },
  [HandleType.CONTROL]: {
    antiAlias: true,
    lineWidth: 1,
    strokeStyle: "red",
    fillStyle: "white",
  },
  [HandleType.DIRECTION]: {
    antiAlias: false,
    lineWidth: 1,
    strokeStyle: "blue",
    fillStyle: "white",
  },
};

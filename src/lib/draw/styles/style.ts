import { HandleType } from "../../../types/handle";

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antialias?: boolean;
}

export const DEFAULT_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: "black",
  fillStyle: "white",
  antialias: true,
};

export const HANDLE_STYLES: Record<HandleType, DrawStyle> = {
  [HandleType.CORNER]: {
    antialias: false,
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "white",
  },
  [HandleType.SMOOTH]: {
    strokeStyle: "green",
    lineWidth: 2,
    fillStyle: "white",
    antialias: false,
  },
  [HandleType.CONTROL]: {
    antialias: true,
    lineWidth: 1,
    strokeStyle: "red",
    fillStyle: "white",
  },
  [HandleType.DIRECTION]: {
    antialias: false,
    lineWidth: 1,
    strokeStyle: "blue",
    fillStyle: "white",
  },
};

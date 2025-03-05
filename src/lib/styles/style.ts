import { HandleType } from "@/types/handle";

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
  dashPattern: number[];
}

export const GUIDE_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: "rgb(76, 96, 230)",
  fillStyle: "black",
  antiAlias: false,
  dashPattern: [],
};

export const DEFAULT_STYLES: DrawStyle = {
  lineWidth: 0.75,
  strokeStyle: "black",
  fillStyle: "white",
  antiAlias: false,
  dashPattern: [],
};

export const HANDLE_STYLES: Record<HandleType, DrawStyle> = {
  corner: {
    lineWidth: 1,
    antiAlias: false,
    strokeStyle: "rgb(76, 96, 230)",
    fillStyle: "rgb(76, 96, 230)",
    dashPattern: [],
  },
  smooth: {
    strokeStyle: "green",
    lineWidth: 2,
    fillStyle: "white",
    antiAlias: false,
    dashPattern: [],
  },
  control: {
    lineWidth: 1,
    strokeStyle: "red",
    fillStyle: "red",
    antiAlias: true,
    dashPattern: [],
  },
  direction: {
    antiAlias: true,
    lineWidth: 1,
    strokeStyle: "#E066A6",
    fillStyle: "#E066A6",
    dashPattern: [],
  },
};

export const SELECTION_RECTANGLE_STYLES: DrawStyle = {
  lineWidth: 1,
  strokeStyle: "#0c8ce9",
  fillStyle: "rgba(59, 130, 246, 0.04)",
  antiAlias: false,
  dashPattern: [],
};

export const BOUNDING_RECTANGLE_STYLES: DrawStyle = {
  lineWidth: 0.75,
  strokeStyle: "#353535",
  fillStyle: "transparent",
  antiAlias: false,
  dashPattern: [5, 5],
};

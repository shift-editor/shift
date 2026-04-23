import type { HandleState } from "@/types/graphics";
import { DEFAULT_THEME, type FirstHandleStyle } from "../Theme";
import { parseCssColor, TRANSPARENT, type GpuColor } from "./color";
import type { GpuHandleShape } from "./types";

const FIRST_HANDLE_GAP_PX = 3;

export const SHAPE_IDS: Record<GpuHandleShape, number> = {
  corner: 0,
  smooth: 1,
  control: 2,
  direction: 3,
  first: 4,
  last: 5,
};

export interface CachedInstanceStyle {
  shapeId: number;
  size: number;
  lineWidth: number;
  fillColor: GpuColor;
  strokeColor: GpuColor;
  overlayColor: GpuColor;
  barSize: number;
  barStrokeColor: GpuColor;
  extentX: number;
  extentY: number;
}

type StyleByState = Record<HandleState, CachedInstanceStyle>;

function buildSimpleStyle(
  shape: "corner" | "smooth" | "control",
  state: HandleState,
): CachedInstanceStyle {
  const style = DEFAULT_THEME.handle[shape][state];
  const halfSize = shape === "corner" ? style.size / 2 : style.size;
  const padding = Math.max(style.lineWidth, 2);

  return {
    shapeId: SHAPE_IDS[shape],
    size: style.size,
    lineWidth: style.lineWidth,
    fillColor: parseCssColor(style.fill),
    strokeColor: parseCssColor(style.stroke),
    overlayColor: style.overlayColor ? parseCssColor(style.overlayColor) : TRANSPARENT,
    barSize: 0,
    barStrokeColor: TRANSPARENT,
    extentX: halfSize + padding,
    extentY: halfSize + padding,
  };
}

function buildDirectionalStyle(
  shape: "direction" | "first" | "last",
  state: HandleState,
): CachedInstanceStyle {
  if (shape === "direction") {
    const style = DEFAULT_THEME.handle.direction[state];
    return {
      shapeId: SHAPE_IDS[shape],
      size: style.size,
      lineWidth: style.lineWidth,
      fillColor: parseCssColor(style.fill),
      strokeColor: parseCssColor(style.stroke),
      overlayColor: style.overlayColor ? parseCssColor(style.overlayColor) : TRANSPARENT,
      barSize: 0,
      barStrokeColor: TRANSPARENT,
      extentX: style.size + style.lineWidth + 2,
      extentY: style.size + style.lineWidth + 2,
    };
  }

  if (shape === "first") {
    const style = DEFAULT_THEME.handle.first[state] as FirstHandleStyle;
    const halfBar = style.barSize / 2;
    const triangleTip = FIRST_HANDLE_GAP_PX + style.size * 2;

    return {
      shapeId: SHAPE_IDS[shape],
      size: style.size,
      lineWidth: style.lineWidth,
      fillColor: parseCssColor(style.fill),
      strokeColor: parseCssColor(style.stroke),
      overlayColor: style.overlayColor ? parseCssColor(style.overlayColor) : TRANSPARENT,
      barSize: style.barSize,
      barStrokeColor: parseCssColor(style.barStroke),
      extentX: triangleTip + style.lineWidth + 2,
      extentY: Math.max(halfBar, style.size * 0.866) + style.lineWidth + 2,
    };
  }

  const style = DEFAULT_THEME.handle.last[state];
  return {
    shapeId: SHAPE_IDS[shape],
    size: style.size,
    lineWidth: style.lineWidth,
    fillColor: parseCssColor(style.fill),
    strokeColor: parseCssColor(style.stroke),
    overlayColor: style.overlayColor ? parseCssColor(style.overlayColor) : TRANSPARENT,
    barSize: style.size,
    barStrokeColor: parseCssColor(style.stroke),
    extentX: style.size / 2 + style.lineWidth + 2,
    extentY: style.lineWidth + 2,
  };
}

function buildStyleByState(shape: GpuHandleShape): StyleByState {
  const build =
    shape === "corner" || shape === "smooth" || shape === "control"
      ? buildSimpleStyle
      : buildDirectionalStyle;
  return {
    idle: build(shape as never, "idle"),
    hovered: build(shape as never, "hovered"),
    selected: build(shape as never, "selected"),
  };
}

export const STYLES = {
  corner: buildStyleByState("corner"),
  smooth: buildStyleByState("smooth"),
  control: buildStyleByState("control"),
  direction: buildStyleByState("direction"),
  first: buildStyleByState("first"),
  last: buildStyleByState("last"),
} as const;

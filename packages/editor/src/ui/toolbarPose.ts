import type { ToolbarDock, ToolbarFrame, ToolbarPose } from "../types/toolbar";
import { TOOLBAR_INSET } from "./toolbarGeometry";

export const TOOLBAR_DOCKS: readonly ToolbarDock[] = ["bottom", "top", "left", "right"];

/**
 * Pose the bar takes in a slot.
 *
 * @remarks
 * The handle is the pivot and sits at the bar's right end when flat, so the
 * bar swings a quarter clockwise to stand. Both side slots use that one pose,
 * which keeps the tools reading top to bottom with the handle at the bottom.
 */
export function poseForDock(dock: ToolbarDock): ToolbarPose {
  return dock === "left" || dock === "right" ? "stand" : "flat";
}

const OPPOSITE_DOCK: Record<ToolbarDock, ToolbarDock> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** The slot across the canvas, which keeps the bar's pose. */
export function oppositeDock(dock: ToolbarDock): ToolbarDock {
  return OPPOSITE_DOCK[dock];
}

/** Whether the frame is too short for a standing bar. */
export function isShortToolbarFrame(frame: ToolbarFrame, barLength: number): boolean {
  return frame.height < barLength + 2 * TOOLBAR_INSET;
}

/** Slots the bar can sit in; a short frame leaves only the top and bottom. */
export function allowedDocksInFrame(
  frame: ToolbarFrame,
  barLength: number,
): readonly ToolbarDock[] {
  if (isShortToolbarFrame(frame, barLength)) return ["bottom", "top"];

  return TOOLBAR_DOCKS;
}

/**
 * Slot to show the bar in: its remembered dock, unless the frame is too short
 * for a standing bar, in which case it rests on the bottom edge.
 *
 * @remarks
 * Display only. The remembered dock is kept, so the bar returns to its side
 * when the frame grows again.
 */
export function fitDockToFrame(
  dock: ToolbarDock,
  frame: ToolbarFrame,
  barLength: number,
): ToolbarDock {
  return allowedDocksInFrame(frame, barLength).includes(dock) ? dock : "bottom";
}

/** Degrees a pose is turned from flat, clockwise positive. */
export function poseAngle(pose: ToolbarPose): number {
  if (pose === "stand") return 90;

  return 0;
}

import type { Point2D } from "@shift/geo";
import type {
  ToolbarDock,
  ToolbarDragStart,
  ToolbarDragState,
  ToolbarFrame,
  ToolbarLift,
} from "../types/toolbar";
import { BAR_THICKNESS, clampHandleToFrame, pointerEdgeDistances } from "./toolbarGeometry";
import { allowedDocksInFrame, poseForDock } from "./toolbarPose";
import { TOOL_FADE_SPAN, toolOpacityForApproach } from "./toolbarPresence";

/** How close the pointer must come to an edge for its slot to take the bar on release. */
export const SNAP_DISTANCE = 120;

/** How far the pointer may drift from a slot's edge before it stops taking the bar. */
export const RELEASE_DISTANCE = 144;

/** How much closer another edge must be before the pointer steers toward it. */
export const SWITCH_MARGIN = 24;

/**
 * How far the pointer must move from where it went down before the bar leaves
 * the slot it started in: half the bar's thickness, so it detaches at once.
 */
export const TEAR_DISTANCE = BAR_THICKNESS / 2;

/** The dock among `docks` whose edge is nearest; the first of equals wins. */
function nearestDock(
  docks: readonly ToolbarDock[],
  distances: Record<ToolbarDock, number>,
): ToolbarDock {
  return docks.reduce((best, next) => (distances[next] < distances[best] ? next : best));
}

/**
 * How far the pointer is outside the range of the nearest slot that would turn
 * a bar docked at `seatDock`, or null when no slot would.
 */
function turnApproach(
  seatDock: ToolbarDock,
  length: number,
  pointer: Point2D,
  frame: ToolbarFrame,
): number | null {
  const seatPose = poseForDock(seatDock);
  const turning = allowedDocksInFrame(frame, length).filter(
    (dock) => poseForDock(dock) !== seatPose,
  );
  if (turning.length === 0) return null;

  const distances = pointerEdgeDistances(pointer, frame);

  return distances[nearestDock(turning, distances)] - SNAP_DISTANCE;
}

/** Begins a drag with the bar held in the slot it was docked to. */
export function startToolbarDrag(start: ToolbarDragStart): ToolbarDragState {
  const approach = turnApproach(start.dock, start.length, start.pointer, start.frame);
  const fadeSpan = Math.min(Math.max(approach ?? 0, 0), TOOL_FADE_SPAN);

  return {
    pointer: start.pointer,
    handle: start.handle,
    handleInBar: start.handleInBar,
    grab: { x: start.handle.x - start.pointer.x, y: start.handle.y - start.pointer.y },
    seatDock: start.dock,
    target: start.dock,
    captured: true,
    length: start.length,
    frame: start.frame,
    tether: start.pointer,
    fadeSpan,
  };
}

/**
 * Edge the pointer is steering toward. The pointer picks the edge, not the bar,
 * because the bar's shape changes with the edge and that would feed back.
 *
 * @remarks
 * Only slots the frame has room for are considered, so what is highlighted is
 * always somewhere the bar can land. The current target keeps a corner until
 * another edge is `SWITCH_MARGIN` closer, and wins exact ties.
 */
function steeredDock(
  pointer: Point2D,
  frame: ToolbarFrame,
  length: number,
  previousTarget: ToolbarDock,
): ToolbarDock {
  const distances = pointerEdgeDistances(pointer, frame);
  const allowed = allowedDocksInFrame(frame, length);
  const targetAllowed = allowed.includes(previousTarget);
  const others = allowed.filter((dock) => dock !== previousTarget);
  const candidates = targetAllowed ? [previousTarget, ...others] : others;
  const nearest = nearestDock(candidates, distances);
  const keepTarget =
    targetAllowed && distances[previousTarget] <= distances[nearest] + SWITCH_MARGIN;

  return keepTarget ? previousTarget : nearest;
}

/**
 * Whether the target slot would take the bar with the pointer where it is.
 *
 * @remarks
 * `target` is always a slot the frame has room for, since steering only picks
 * from those. Range is the pointer's distance from the edge, so the pull needed is the same
 * on every edge. A slot already taking the bar keeps it a little farther out.
 */
function captures(
  previous: ToolbarDragState,
  target: ToolbarDock,
  pointer: Point2D,
  frame: ToolbarFrame,
): boolean {
  const holding = previous.captured && previous.target === target;
  const range = holding ? RELEASE_DISTANCE : SNAP_DISTANCE;

  return pointerEdgeDistances(pointer, frame)[target] <= range;
}

/** Whether the pointer is still close enough to where it went down to hold the bar in. */
function isTethered(drag: ToolbarDragState, pointer: Point2D): boolean {
  const { tether } = drag;
  if (!tether) return false;

  return Math.hypot(pointer.x - tether.x, pointer.y - tether.y) <= TEAR_DISTANCE;
}

/**
 * Moves a drag to the pointer.
 *
 * @remarks
 * The bar keeps its pose and follows the pointer for the whole drag. The target
 * slot only decides where it lands on release, so it never moves or turns on its own. It
 * starts held in its slot and comes loose once the pointer has moved
 * `TEAR_DISTANCE`.
 */
export function nextToolbarDrag(
  previous: ToolbarDragState,
  pointer: Point2D,
  frame: ToolbarFrame,
): ToolbarDragState {
  if (isTethered(previous, pointer)) return { ...previous, pointer, frame };

  const target = steeredDock(pointer, frame, previous.length, previous.target);
  const handle = clampHandleToFrame(
    { x: pointer.x + previous.grab.x, y: pointer.y + previous.grab.y },
    frame,
  );
  const captured = captures(previous, target, pointer, frame);

  return { ...previous, pointer, handle, target, frame, tether: null, captured };
}

/** Top-left corner of the carried bar, so its handle sits where the pointer holds it. */
export function toolbarBarOrigin(drag: ToolbarDragState): Point2D {
  return { x: drag.handle.x - drag.handleInBar.x, y: drag.handle.y - drag.handleInBar.y };
}

/**
 * Opacity of the tools while the bar is carried.
 *
 * @remarks
 * The tools are fully visible when the drag begins and while the bar can only
 * slide. They dim as the pointer nears a slot that would turn the bar, then
 * come back to full once that slot's zone takes the bar, so a highlighted,
 * lifted bar never looks faded. The turn on release dims them again. They are
 * fully visible while the bar is docked.
 */
export function toolbarToolOpacity(drag: ToolbarDragState | null): number {
  if (!drag || drag.captured) return 1;

  const approach = turnApproach(drag.seatDock, drag.length, drag.pointer, drag.frame);

  return toolOpacityForApproach(approach, drag.fadeSpan);
}

/** How far the bar is raised: lifted over a highlighted slot, flat once clear of every slot. */
export function toolbarLift(drag: ToolbarDragState | null): ToolbarLift {
  if (!drag) return "rest";
  if (drag.captured) return "lifted";

  return "floating";
}

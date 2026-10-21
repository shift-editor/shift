import { Vec2, type Point2D } from "@shift/geo";
import type {
  ToolbarDock,
  ToolbarDragStart,
  ToolbarDragState,
  ToolbarFrame,
  ToolbarLift,
} from "../types/toolbar";
import { BAR_THICKNESS, clampHandleToFrame, isInDockZone } from "./toolbarGeometry";
import { allowedDocksInFrame, isShortToolbarFrame, oppositeDock, poseForDock } from "./toolbarPose";
import { TOOL_FLOOR_OPACITY } from "./toolbarPresence";

/** How far the pointer may stray past the target's zone before a neighbouring zone takes over. */
export const ZONE_MARGIN = 16;

/**
 * How far the pointer must move from where it went down before the bar leaves
 * the slot it started in: half the bar's thickness, so it detaches at once.
 */
export const TEAR_DISTANCE = BAR_THICKNESS / 2;

/** Longest gap between two presses of the handle that still counts as a double press. */
export const DOUBLE_PRESS_MS = 400;

/** Begins a drag with the bar held in the slot it was docked to. */
export function startToolbarDrag(start: ToolbarDragStart): ToolbarDragState {
  return {
    pointer: start.pointer,
    handle: start.handle,
    handleInBar: start.handleInBar,
    grab: Vec2.sub(start.handle, start.pointer),
    seatDock: start.dock,
    target: start.dock,
    length: start.length,
    frame: start.frame,
    tether: start.pointer,
  };
}

/** Share of the bar, from its far end, that must be in a zone to steer there when the handle trails. */
export const TRAILING_REACH = 1 / 3;

/**
 * Point on the carried bar that steers the target when the handle trails:
 * `TRAILING_REACH` of the way in from the end away from the handle, across
 * the middle of the bar.
 *
 * @remarks
 * The carried bar keeps its pose, so this stays a fixed offset from the
 * handle for the whole drag.
 */
export function toolbarBarReach(drag: ToolbarDragState): Point2D {
  const origin = toolbarBarOrigin(drag);
  const reach = drag.length * TRAILING_REACH;

  // The far end is the bar's left end when flat and its top end when standing.
  if (poseForDock(drag.seatDock) === "stand") {
    return Vec2.add(origin, { x: BAR_THICKNESS / 2, y: reach });
  }

  return Vec2.add(origin, { x: reach, y: BAR_THICKNESS / 2 });
}

/**
 * Edge the carried bar is steering toward.
 *
 * @remarks
 * Each slot the frame has room for owns a zone. The target changes when the
 * pointer, or failing that the bar's reach point, enters another slot's zone,
 * and only once it is `ZONE_MARGIN` clear of the current target's zone. The
 * handle sits at one end of the bar, so the pointer leads in some directions
 * and trails in others: when it leads it switches the target as soon as it
 * arrives, and when it trails the reach point switches it once
 * `TRAILING_REACH` of the bar is in. Either way the switch never waits for
 * the trailing end. The centre of the
 * frame belongs to no zone, so a bar there keeps the target it has.
 */
function steeredDock(
  pointer: Point2D,
  reach: Point2D,
  frame: ToolbarFrame,
  length: number,
  previousTarget: ToolbarDock,
): ToolbarDock {
  const allowed = allowedDocksInFrame(frame, length);
  const flatOnly = isShortToolbarFrame(frame, length);
  const targetAllowed = allowed.includes(previousTarget);
  const claimedBy = (point: Point2D): ToolbarDock | undefined => {
    if (targetAllowed && isInDockZone(previousTarget, point, frame, flatOnly, ZONE_MARGIN)) {
      return undefined;
    }

    return allowed.find(
      (dock) => dock !== previousTarget && isInDockZone(dock, point, frame, flatOnly),
    );
  };
  const claimed = claimedBy(pointer) ?? claimedBy(reach);
  if (claimed) return claimed;

  return targetAllowed ? previousTarget : allowed[0];
}

/** Whether the pointer is still close enough to where it went down to hold the bar in. */
function isTethered(drag: ToolbarDragState, pointer: Point2D): boolean {
  const { tether } = drag;
  if (!tether) return false;

  return Vec2.dist(pointer, tether) <= TEAR_DISTANCE;
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

  const handle = clampHandleToFrame(Vec2.add(pointer, previous.grab), frame);
  const moved = { ...previous, pointer, handle, frame, tether: null };
  const target = steeredDock(
    pointer,
    toolbarBarReach(moved),
    frame,
    previous.length,
    previous.target,
  );

  return { ...moved, target };
}

/** Whether the handle was pressed and let go without pulling the bar loose. */
export function isPress(drag: ToolbarDragState): boolean {
  return drag.tether !== null;
}

/**
 * Slot the bar lands in on release.
 *
 * @remarks
 * A second press within `DOUBLE_PRESS_MS` of the first flips the bar to the
 * opposite edge. Its pose stays the same, so it slides across without turning.
 *
 * @param sincePreviousPress - milliseconds since the last press on the handle.
 */
export function releasedDock(drag: ToolbarDragState, sincePreviousPress: number): ToolbarDock {
  if (isPress(drag) && sincePreviousPress <= DOUBLE_PRESS_MS) return oppositeDock(drag.seatDock);

  return drag.target;
}

/** Top-left corner of the carried bar, so its handle sits where the pointer holds it. */
export function toolbarBarOrigin(drag: ToolbarDragState): Point2D {
  return Vec2.sub(drag.handle, drag.handleInBar);
}

/**
 * Opacity of the tools while the bar is carried.
 *
 * @remarks
 * The tools dim while the target slot would turn the bar on release, warning
 * of the turn before the pointer lets go, and are fully visible otherwise.
 * The turn itself dips them further.
 */
export function toolbarToolOpacity(drag: ToolbarDragState | null): number {
  if (!drag) return 1;

  const turns = poseForDock(drag.target) !== poseForDock(drag.seatDock);

  return turns ? TOOL_FLOOR_OPACITY : 1;
}

/** How far the bar is raised: lifted while carried, resting once docked. */
export function toolbarLift(drag: ToolbarDragState | null): ToolbarLift {
  return drag ? "lifted" : "rest";
}

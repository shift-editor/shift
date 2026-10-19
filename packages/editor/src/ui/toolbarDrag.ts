import { Vec2, type Point2D } from "@shift/geo";
import type {
  ToolbarDock,
  ToolbarDragStart,
  ToolbarDragState,
  ToolbarFrame,
  ToolbarLift,
} from "../types/toolbar";
import { BAR_THICKNESS, clampHandleToFrame, dockRegionAt } from "./toolbarGeometry";
import { allowedDocksInFrame, isShortToolbarFrame, oppositeDock, poseForDock } from "./toolbarPose";
import { TOOL_FLOOR_OPACITY } from "./toolbarPresence";

/** How far a steering point may stray from the target's region before a neighbouring region takes over. */
export const REGION_MARGIN = BAR_THICKNESS / 2;

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

/** Centre of the carried bar, which keeps the pose of the slot it was picked up from. */
export function toolbarBarCentre(drag: ToolbarDragState): Point2D {
  const origin = toolbarBarOrigin(drag);
  const stands = poseForDock(drag.seatDock) === "stand";
  const width = stands ? BAR_THICKNESS : drag.length;
  const height = stands ? drag.length : BAR_THICKNESS;

  return { x: origin.x + width / 2, y: origin.y + height / 2 };
}

/**
 * Whether the bar's body, not its handle, leads toward `dock`.
 *
 * @remarks
 * The handle is the end of the bar that leads toward the bottom and right. A
 * standing bar's body leads toward the top and a flat bar's toward the left,
 * because the handle trails in those directions.
 */
function bodyLeads(dock: ToolbarDock, seatDock: ToolbarDock): boolean {
  return poseForDock(seatDock) === "stand" ? dock === "top" : dock === "left";
}

/** Whether `point` is on the canvas. */
function isInFrame(point: Point2D, frame: ToolbarFrame): boolean {
  return point.x >= 0 && point.x <= frame.width && point.y >= 0 && point.y <= frame.height;
}

/** Whether `point`, or any point within `margin` of it along an axis, is in the region of `dock` for a bar carried from `seatDock`. */
function isInRegion(
  dock: ToolbarDock,
  point: Point2D,
  frame: ToolbarFrame,
  length: number,
  flatOnly: boolean,
  margin: number,
  seatDock: ToolbarDock,
): boolean {
  const probes = [
    point,
    { x: point.x + margin, y: point.y },
    { x: point.x - margin, y: point.y },
    { x: point.x, y: point.y + margin },
    { x: point.x, y: point.y - margin },
  ];

  return probes.some((probe) => dockRegionAt(probe, frame, length, flatOnly, seatDock) === dock);
}

/**
 * Edge the carried bar is steering toward.
 *
 * @remarks
 * Each dock the frame has room for claims the bar when its leading point is
 * in its region: the bar's centre for the docks its body leads toward, and the
 * handle for the rest. The current target claims with a `REGION_MARGIN`, so a
 * shaking pointer cannot flip it. With no claim, as when the region belongs
 * to a dock the frame has no room for, the target stays. When the body claims a dock the handle does not, the body
 * wins, so the far end switches the target as soon as it arrives; otherwise
 * the current target is kept if it still claims. A far end hanging off the
 * canvas cannot start a claim, so the handle decides, but it keeps the claim
 * of the target it already holds.
 *
 * The claims depend only on the bar's position, and the current target is
 * always among them once chosen, so a held pointer settles on its first step.
 */
function steeredDock(
  handle: Point2D,
  centre: Point2D,
  frame: ToolbarFrame,
  length: number,
  seatDock: ToolbarDock,
  previousTarget: ToolbarDock,
): ToolbarDock {
  const allowed = allowedDocksInFrame(frame, length);
  const flatOnly = isShortToolbarFrame(frame, length);
  const targetAllowed = allowed.includes(previousTarget);
  const bodyOnCanvas = isInFrame(centre, frame);
  // Off the canvas the far end cannot start a claim, but it keeps the one it holds, so crossing the frame's edge never hands the target back.
  const leadsByBody = (dock: ToolbarDock) => bodyOnCanvas && bodyLeads(dock, seatDock);
  const claimsBar = (dock: ToolbarDock): boolean => {
    const margin = dock === previousTarget ? REGION_MARGIN : 0;
    const byHandle = isInRegion(dock, handle, frame, length, flatOnly, margin, seatDock);
    if (!bodyLeads(dock, seatDock)) return byHandle;

    const byBody = isInRegion(dock, centre, frame, length, flatOnly, margin, seatDock);
    if (bodyOnCanvas) return byBody;
    if (dock === previousTarget) return byBody || byHandle;

    return byHandle;
  };
  const claims = allowed.filter(claimsBar);
  if (claims.length === 0) return targetAllowed ? previousTarget : allowed[0];

  const bodyClaims = claims.filter(leadsByBody);
  const contenders = bodyClaims.length > 0 ? bodyClaims : claims;
  if (contenders.includes(previousTarget)) return previousTarget;

  return contenders[0];
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
    handle,
    toolbarBarCentre(moved),
    frame,
    previous.length,
    previous.seatDock,
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

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
  const size = stands
    ? Vec2.create(BAR_THICKNESS, drag.length)
    : Vec2.create(drag.length, BAR_THICKNESS);

  return Vec2.add(origin, Vec2.scale(size, 0.5));
}

/**
 * Tip of the carried bar: the end opposite the handle, as far from its end as
 * the handle is from its own, so the handle reflected through the bar's centre.
 */
export function toolbarBarTip(drag: ToolbarDragState): Point2D {
  return Vec2.mirror(drag.handle, toolbarBarCentre(drag));
}

/**
 * Whether the bar's tip, not its handle, leads toward `dock`.
 *
 * @remarks
 * The handle is the end of the bar that leads toward the bottom and right. A
 * standing bar's tip leads toward the top and a flat bar's toward the left,
 * because the handle trails in those directions.
 */
function tipLeads(dock: ToolbarDock, seatDock: ToolbarDock): boolean {
  return poseForDock(seatDock) === "stand" ? dock === "top" : dock === "left";
}

/** The point and the four points `margin` away from it along an axis. */
function probesAround(point: Point2D, margin: number): Point2D[] {
  const offsets = [
    Vec2.fromAxis("x", margin),
    Vec2.fromAxis("x", -margin),
    Vec2.fromAxis("y", margin),
    Vec2.fromAxis("y", -margin),
  ];

  return [point, ...offsets.map((offset) => Vec2.add(point, offset))];
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
  return probesAround(point, margin).some(
    (probe) => dockRegionAt(probe, frame, length, flatOnly, seatDock) === dock,
  );
}

/** Whether `point` and every point within `margin` of it along an axis are in the region of `dock`. */
function isDeepInRegion(
  dock: ToolbarDock,
  point: Point2D,
  frame: ToolbarFrame,
  length: number,
  flatOnly: boolean,
  margin: number,
  seatDock: ToolbarDock,
): boolean {
  return probesAround(point, margin).every(
    (probe) => dockRegionAt(probe, frame, length, flatOnly, seatDock) === dock,
  );
}

/**
 * The docks that claim the bar, given the target it holds.
 *
 * @remarks
 * Each dock the frame has room for claims the bar when its leading point is
 * in its region: the tip for the docks it leads toward, and the handle for the
 * rest. The handle's docks need only the handle in the region to take the
 * bar over, since the target keeps its own claim through a `REGION_MARGIN`; the
 * tip's docks need the tip a margin inside, so both ends wait the same distance.
 */
function claimingDocks(
  handle: Point2D,
  tip: Point2D,
  frame: ToolbarFrame,
  length: number,
  seatDock: ToolbarDock,
  target: ToolbarDock,
): ToolbarDock[] {
  const flatOnly = isShortToolbarFrame(frame, length);

  return allowedDocksInFrame(frame, length).filter((dock) => {
    const margin = dock === target ? REGION_MARGIN : 0;
    if (!tipLeads(dock, seatDock)) {
      return isInRegion(dock, handle, frame, length, flatOnly, margin, seatDock);
    }
    if (dock === target) return isInRegion(dock, tip, frame, length, flatOnly, margin, seatDock);

    return isDeepInRegion(dock, tip, frame, length, flatOnly, REGION_MARGIN, seatDock);
  });
}

/** The docks claiming the carried bar where it is now, for the debug overlay. */
export function toolbarClaims(drag: ToolbarDragState): ToolbarDock[] {
  return claimingDocks(
    drag.handle,
    toolbarBarTip(drag),
    drag.frame,
    drag.length,
    drag.seatDock,
    drag.target,
  );
}

/**
 * Edge the carried bar is steering toward.
 *
 * @remarks
 * The target keeps its claim through a `REGION_MARGIN`, so a shaking pointer
 * cannot flip it. With no claim, as when the region belongs to a dock the frame
 * has no room for, the target stays. When the tip claims a dock the handle
 * does not, the tip wins, so the far end switches the target as soon as it is
 * a margin inside; otherwise the current target is kept if it still claims.
 *
 * The claims depend only on the bar's position, and the current target is
 * among them once chosen whenever anything claims, so a held pointer settles
 * on its first step. When nothing claims, the target is held unchanged.
 */
function steeredDock(
  handle: Point2D,
  tip: Point2D,
  frame: ToolbarFrame,
  length: number,
  seatDock: ToolbarDock,
  previousTarget: ToolbarDock,
): ToolbarDock {
  const claims = claimingDocks(handle, tip, frame, length, seatDock, previousTarget);
  if (claims.length === 0) {
    const allowed = allowedDocksInFrame(frame, length);

    return allowed.includes(previousTarget) ? previousTarget : allowed[0];
  }

  const tipClaims = claims.filter((dock) => tipLeads(dock, seatDock));
  const contenders = tipClaims.length > 0 ? tipClaims : claims;
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
    toolbarBarTip(moved),
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

/** How far the bar is raised: lifted while carried, resting once docked. */
export function toolbarLift(drag: ToolbarDragState | null): ToolbarLift {
  return drag ? "lifted" : "rest";
}

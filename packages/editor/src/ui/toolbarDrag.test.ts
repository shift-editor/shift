import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { TOOLBAR_INSET } from "./toolbarGeometry";
import { poseForDock } from "./toolbarPose";
import { TOOL_FLOOR_OPACITY } from "./toolbarPresence";
import {
  DOUBLE_PRESS_MS,
  TEAR_DISTANCE,
  TRAILING_REACH,
  ZONE_MARGIN,
  nextToolbarDrag,
  releasedDock,
  startToolbarDrag,
  toolbarBarReach,
  toolbarBarOrigin,
  toolbarLift,
  toolbarToolOpacity,
} from "./toolbarDrag";

const FRAME: ToolbarFrame = { width: 1000, height: 700 };
const LENGTH = 320;

/** Where the handle sits inside a bar: at the right end when flat, at the bottom when standing. */
function handleInBar(dock: ToolbarDock): Point2D {
  if (poseForDock(dock) === "stand") return { x: 24, y: LENGTH - 17 };

  return { x: LENGTH - 17, y: 24 };
}

/** Handle centre of a bar seated in `dock`: its slot is centred along the edge, inset from it. */
function seatedHandle(dock: ToolbarDock, frame: ToolbarFrame): Point2D {
  const offset = handleInBar(dock);
  const centred = { x: (frame.width - LENGTH) / 2, y: (frame.height - LENGTH) / 2 };
  const slot: Record<ToolbarDock, Point2D> = {
    top: { x: centred.x, y: TOOLBAR_INSET },
    bottom: { x: centred.x, y: frame.height - TOOLBAR_INSET - 48 },
    left: { x: TOOLBAR_INSET, y: centred.y },
    right: { x: frame.width - TOOLBAR_INSET - 48, y: centred.y },
  };

  return { x: slot[dock].x + offset.x, y: slot[dock].y + offset.y };
}

/** Starts a drag with the pointer on the handle of a bar seated in `dock`. */
function startFrom(dock: ToolbarDock, frame: ToolbarFrame = FRAME): ToolbarDragState {
  const handle = seatedHandle(dock, frame);

  return startToolbarDrag({
    dock,
    length: LENGTH,
    pointer: handle,
    handle,
    handleInBar: handleInBar(dock),
    frame,
  });
}

function dragTo(
  start: ToolbarDragState,
  pointer: Point2D,
  frame: ToolbarFrame = FRAME,
): ToolbarDragState {
  return nextToolbarDrag(start, pointer, frame);
}

/** Moves the pointer so the carried bar's reach point lands on `reach`. */
function reachTo(
  drag: ToolbarDragState,
  reach: Point2D,
  frame: ToolbarFrame = FRAME,
): ToolbarDragState {
  const now = toolbarBarReach(drag);

  return dragTo(drag, nudged(drag.pointer, reach.x - now.x, reach.y - now.y), frame);
}

function nudged(point: Point2D, dx: number, dy: number): Point2D {
  return { x: point.x + dx, y: point.y + dy };
}

describe("a bar held in its slot comes loose after a short pull", () => {
  const start = startFrom("bottom");

  it("stays held while the pointer is within half the bar's thickness", () => {
    const drag = dragTo(start, nudged(start.pointer, TEAR_DISTANCE, 0));

    expect(drag.tether).not.toBeNull();
  });

  it("detaches and follows the pointer as soon as it passes that", () => {
    const pointer = nudged(start.pointer, TEAR_DISTANCE + 1, 0);
    const drag = dragTo(start, pointer);

    expect(drag.tether).toBeNull();
    expect(drag.handle).toEqual(pointer);
  });

  it("detaches for a pull in any direction", () => {
    expect(dragTo(start, nudged(start.pointer, 0, -(TEAR_DISTANCE + 1))).tether).toBeNull();
    expect(dragTo(start, nudged(start.pointer, -(TEAR_DISTANCE + 1), 0)).tether).toBeNull();
  });

  it("keeps its slot when released without being pulled", () => {
    expect(start.target).toBe("bottom");
  });

  it("returns to its own slot when released near it after being pulled loose", () => {
    const drag = dragTo(start, { x: 700, y: 600 });

    expect(drag).toMatchObject({ tether: null, target: "bottom" });
  });
});

describe("a double press on the handle flips the bar across the canvas", () => {
  it("sends it to the opposite edge when the second press comes quickly", () => {
    expect(releasedDock(startFrom("bottom"), DOUBLE_PRESS_MS)).toBe("top");
    expect(releasedDock(startFrom("left"), 100)).toBe("right");
  });

  it("leaves it in its slot when the presses are too far apart", () => {
    expect(releasedDock(startFrom("bottom"), DOUBLE_PRESS_MS + 1)).toBe("bottom");
  });

  it("lands where it was dragged when the second press pulled it loose", () => {
    const drag = dragTo(startFrom("bottom"), { x: 900, y: 350 });

    expect(releasedDock(drag, 100)).toBe("right");
  });
});

describe("the frame is split into a zone per slot", () => {
  const start = startFrom("bottom");

  it("docks to the top or bottom across the whole width of their quarter", () => {
    expect(reachTo(start, { x: 200, y: 100 }).target).toBe("top");
    expect(reachTo(start, { x: 800, y: 100 }).target).toBe("top");
    expect(reachTo(start, { x: 200, y: 650 }).target).toBe("bottom");
    expect(reachTo(start, { x: 800, y: 650 }).target).toBe("bottom");
  });

  it("gives the outer thirds of the band between them to left and right", () => {
    expect(reachTo(start, { x: 300, y: 350 }).target).toBe("left");
    expect(reachTo(start, { x: 700, y: 350 }).target).toBe("right");
  });

  it("keeps whatever the target is across the centre of the band", () => {
    const onLeft = reachTo(start, { x: 300, y: 350 });
    const onTop = reachTo(start, { x: 500, y: 100 });

    expect(reachTo(start, { x: 450, y: 350 }).target).toBe("bottom");
    expect(reachTo(onLeft, { x: 450, y: 350 }).target).toBe("left");
    expect(reachTo(onTop, { x: 450, y: 350 }).target).toBe("top");
  });

  it("targets a slot without moving or turning the bar", () => {
    const drag = dragTo(start, { x: 400, y: 350 });

    expect(drag).toMatchObject({ target: "left", seatDock: "bottom" });
    expect(drag.handle).toEqual({ x: 400, y: 350 });
  });

  it("keeps steering by zone once the pointer leaves the frame", () => {
    expect(dragTo(start, { x: -200, y: 350 }).target).toBe("left");
    expect(dragTo(start, { x: 500, y: -300 }).target).toBe("top");
  });

  it("holds the handle inside the frame however far the pointer wanders", () => {
    expect(dragTo(start, { x: 5000, y: 5000 }).handle).toEqual({ x: 988, y: 688 });
  });
});

describe("whichever reaches a zone first, the pointer or the bar's reach point, steers", () => {
  it("puts the reach point a share of the way in from the end away from the handle", () => {
    const flat = dragTo(startFrom("bottom"), { x: 500, y: 400 });
    const standing = dragTo(startFrom("left"), { x: 300, y: 500 });
    const reach = LENGTH * TRAILING_REACH;

    expect(toolbarBarReach(flat)).toEqual({ x: 500 - (LENGTH - 17) + reach, y: 400 });
    expect(toolbarBarReach(standing)).toEqual({ x: 300, y: 500 - (LENGTH - 17) + reach });
  });

  it("turns a standing bar to the top once its far third is in, though the handle trails", () => {
    const reaching = reachTo(startFrom("left"), { x: 100, y: 150 });

    expect(reaching.target).toBe("top");
    expect(reaching.handle.y).toBeGreaterThan(175);
  });

  it("turns a standing bar to the bottom as soon as the leading handle is in", () => {
    const side = startFrom("left");
    const bottomEdge = 525 + ZONE_MARGIN;
    const arriving = dragTo(side, { x: 100, y: bottomEdge + 1 });

    expect(dragTo(side, { x: 100, y: bottomEdge }).target).toBe("left");
    expect(arriving.target).toBe("bottom");
    expect(toolbarBarReach(arriving).y).toBeLessThan(525);
  });

  it("reaches the bottom from a side even where the far end could not get there", () => {
    const frame = { width: 1000, height: 670 };
    const side = startFrom("left", frame);

    expect(dragTo(side, { x: 100, y: 660 }, frame).target).toBe("bottom");
  });
});

describe("a zone stays with the target until the bar is clearly past it", () => {
  const onLeft = reachTo(startFrom("bottom"), { x: 100, y: 350 });

  it("hands a flat bar to the right side once its leading handle is in that third", () => {
    expect(dragTo(onLeft, { x: 666, y: 350 }).target).toBe("left");
    expect(dragTo(onLeft, { x: 667, y: 350 }).target).toBe("right");
  });

  it("keeps the target past the top of the band by up to the margin", () => {
    expect(reachTo(onLeft, { x: 100, y: 175 - ZONE_MARGIN }).target).toBe("left");
    expect(reachTo(onLeft, { x: 100, y: 175 - ZONE_MARGIN - 1 }).target).toBe("top");
  });
});

describe("the bar keeps the spot where it was grabbed", () => {
  it("holds the handle at the same offset from the pointer after detaching", () => {
    const handle = { x: 643, y: 664 };
    const pointer = { x: 648, y: 667 };
    const start = startToolbarDrag({
      dock: "bottom",
      length: LENGTH,
      pointer,
      handle,
      handleInBar: handleInBar("bottom"),
      frame: FRAME,
    });
    const drag = dragTo(start, { x: 500, y: 400 });

    expect(drag.handle).toEqual({ x: 495, y: 397 });
  });
});

describe("the carried bar is placed by its handle", () => {
  it("puts the bar's corner a handle-offset away from the handle", () => {
    const drag = dragTo(startFrom("bottom"), { x: 500, y: 400 });

    expect(toolbarBarOrigin(drag)).toEqual({ x: 500 - (LENGTH - 17), y: 400 - 24 });
  });

  it("lets the rest of a turned bar run past the frame while the handle stays in", () => {
    const drag = dragTo(startFrom("left"), { x: 40, y: 20 });

    expect(drag.handle).toEqual({ x: 40, y: 20 });
    expect(toolbarBarOrigin(drag).y).toBeLessThan(0);
  });
});

describe("a short frame keeps the bar flat", () => {
  const frame = { width: 1000, height: 300 };
  const start = startFrom("bottom", frame);

  it("splits the frame into a top and a bottom half, even beside a side edge", () => {
    expect(reachTo(start, { x: 50, y: 200 }, frame).target).toBe("bottom");
    expect(reachTo(start, { x: 50, y: 100 }, frame).target).toBe("top");
  });

  it("leaves a side target it held before the frame shrank", () => {
    const wasTall: ToolbarDragState = { ...start, tether: null, target: "left" };

    expect(reachTo(wasTall, { x: 50, y: 200 }, frame).target).toBe("bottom");
  });

  it("never dims the tools, since nothing would turn the bar", () => {
    expect(toolbarToolOpacity(reachTo(start, { x: 50, y: 100 }, frame))).toBe(1);
  });
});

describe("the tools dim while the target would turn the bar", () => {
  const start = startFrom("bottom");

  it("are fully visible while the bar is docked", () => {
    expect(toolbarToolOpacity(null)).toBe(1);
  });

  it("are fully visible when the drag begins", () => {
    expect(toolbarToolOpacity(start)).toBe(1);
  });

  it("stay fully visible while heading for a slot that only slides the bar", () => {
    expect(toolbarToolOpacity(reachTo(start, { x: 500, y: 50 }))).toBe(1);
  });

  it("dim while a side slot is the target, and recover when it no longer is", () => {
    const onLeft = reachTo(start, { x: 300, y: 350 });

    expect(toolbarToolOpacity(onLeft)).toBe(TOOL_FLOOR_OPACITY);
    expect(toolbarToolOpacity(reachTo(onLeft, { x: 500, y: 650 }))).toBe(1);
  });

  it("stay fully visible moving between the two sides of a standing bar", () => {
    const side = startFrom("left");

    expect(toolbarToolOpacity(reachTo(side, { x: 800, y: 300 }))).toBe(1);
  });
});

describe("the bar's lift", () => {
  it("rests when docked", () => {
    expect(toolbarLift(null)).toBe("rest");
  });

  it("lifts for the whole drag", () => {
    const start = startFrom("bottom");

    expect(toolbarLift(start)).toBe("lifted");
    expect(toolbarLift(reachTo(start, { x: 500, y: 350 }))).toBe("lifted");
  });
});

import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { TOOLBAR_INSET } from "./toolbarGeometry";
import { poseForDock } from "./toolbarPose";
import { TOOL_FLOOR_OPACITY } from "./toolbarPresence";
import {
  TEAR_DISTANCE,
  nextToolbarDrag,
  startToolbarDrag,
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

    expect(drag).toMatchObject({ tether: null, captured: true, target: "bottom" });
  });
});

describe("the bar follows the pointer and slots only decide where it lands", () => {
  const start = startFrom("bottom");

  it("highlights the left slot without moving or turning the bar", () => {
    const drag = dragTo(start, { x: 100, y: 500 });

    expect(drag).toMatchObject({ captured: true, target: "left", seatDock: "bottom" });
    expect(drag.handle).toEqual({ x: 100, y: 500 });
  });

  it("highlights the right slot the same way", () => {
    const drag = dragTo(start, { x: 900, y: 500 });

    expect(drag).toMatchObject({ captured: true, target: "right", seatDock: "bottom" });
  });

  it("needs the same pull from either side", () => {
    expect(dragTo(start, { x: 120, y: 500 }).captured).toBe(true);
    expect(dragTo(start, { x: 121, y: 500 }).captured).toBe(false);
    expect(dragTo(start, { x: 880, y: 500 }).captured).toBe(true);
    expect(dragTo(start, { x: 879, y: 500 }).captured).toBe(false);
  });

  it("captures however far the turned bar would run past the frame", () => {
    expect(dragTo(start, { x: 40, y: 100 })).toMatchObject({ captured: true, target: "left" });
    expect(dragTo(start, { x: 960, y: 500 })).toMatchObject({ captured: true, target: "right" });
  });

  it("keeps a slot a little farther out than it took it, then lets go", () => {
    const captured = dragTo(start, { x: 120, y: 500 });

    expect(dragTo(captured, { x: 144, y: 500 }).captured).toBe(true);
    expect(dragTo(captured, { x: 145, y: 500 }).captured).toBe(false);
  });

  it("holds the handle inside the frame however far the pointer wanders", () => {
    expect(dragTo(start, { x: 5000, y: 5000 }).handle).toEqual({ x: 988, y: 688 });
  });
});

describe("a corner stays with its owner until another edge clearly wins", () => {
  const start = startFrom("bottom");
  const tornFrom = (target: ToolbarDock): ToolbarDragState => ({
    ...start,
    tether: null,
    target,
    captured: true,
  });

  it("lets the current owner keep an exact tie", () => {
    const tie = { x: 100, y: 600 };

    expect(dragTo(tornFrom("bottom"), tie).target).toBe("bottom");
    expect(dragTo(tornFrom("left"), tie).target).toBe("left");
  });

  it("hands the corner over only once the other edge is more than the margin closer", () => {
    expect(dragTo(tornFrom("bottom"), { x: 76, y: 600 }).target).toBe("bottom");
    expect(dragTo(tornFrom("bottom"), { x: 75, y: 600 }).target).toBe("left");
  });

  it("gives the corner to the nearest edge when the owner is far away", () => {
    expect(dragTo(tornFrom("top"), { x: 80, y: 600 }).target).toBe("left");
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

describe("the slot the bar lands in on release", () => {
  const start = startFrom("bottom");

  it("is the highlighted slot", () => {
    expect(dragTo(start, { x: 100, y: 500 }).target).toBe("left");
  });

  it("is the nearest slot when the pointer is clear of every zone", () => {
    const drag = dragTo(start, { x: 500, y: 300 });

    expect(drag).toMatchObject({ captured: false, target: "top" });
  });

  it("stays with the slot it came from until the other is clearly nearer", () => {
    expect(dragTo(start, { x: 500, y: 340 }).target).toBe("bottom");
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

  it("steers to the nearest slot it can hold, even beside a side edge", () => {
    const drag = dragTo(start, { x: 50, y: 200 }, frame);

    expect(drag).toMatchObject({ target: "bottom", captured: true });
  });

  it("leaves a side target it held before the frame shrank", () => {
    const wasTall: ToolbarDragState = { ...start, tether: null, target: "left", captured: true };
    const drag = dragTo(wasTall, { x: 50, y: 200 }, frame);

    expect(drag).toMatchObject({ target: "bottom", captured: true });
  });

  it("highlights nothing for a pointer clear of the top and bottom slots", () => {
    expect(dragTo(start, { x: 50, y: 150 }, frame).captured).toBe(false);
  });

  it("never fades the tools, since nothing would turn the bar", () => {
    expect(toolbarToolOpacity(dragTo(start, { x: 50, y: 200 }, frame))).toBe(1);
  });
});

describe("the tools fade as the pointer nears a slot that turns the bar", () => {
  const start = startFrom("bottom");

  it("are fully visible while the bar is docked", () => {
    expect(toolbarToolOpacity(null)).toBe(1);
  });

  it("are fully visible when the drag begins", () => {
    expect(toolbarToolOpacity(start)).toBe(1);
  });

  it("stay fully visible while heading for a slot that only slides the bar", () => {
    expect(toolbarToolOpacity(dragTo(start, { x: 500, y: 50 }))).toBe(1);
  });

  it("fade progressively on the way to a turning slot", () => {
    const far = toolbarToolOpacity(dragTo(start, { x: 300, y: 500 }));
    const near = toolbarToolOpacity(dragTo(start, { x: 200, y: 500 }));

    expect(far).toBeLessThan(1);
    expect(near).toBeLessThan(far);
    expect(near).toBeGreaterThan(TOOL_FLOOR_OPACITY);
  });

  it("are nearly at their floor just outside the slot's range", () => {
    const outside = toolbarToolOpacity(dragTo(start, { x: 121, y: 500 }));

    expect(outside).toBeGreaterThan(TOOL_FLOOR_OPACITY);
    expect(outside).toBeLessThan(TOOL_FLOOR_OPACITY + 0.05);
  });

  it("return to full once the slot's zone takes the bar, so a lifted bar is never faded", () => {
    expect(toolbarToolOpacity(dragTo(start, { x: 120, y: 500 }))).toBe(1);
    expect(toolbarToolOpacity(dragTo(start, { x: 880, y: 500 }))).toBe(1);
  });

  it("never fade for a bar that began inside the turning slot's range", () => {
    const frame = { width: 1000, height: 480 };
    const side = startFrom("left", frame);

    expect(toolbarToolOpacity(dragTo(side, { x: 500, y: 240 }, frame))).toBe(1);
  });

  it("start fully visible even in a canvas where the turning slot is close", () => {
    const frame = { width: 1200, height: 600 };
    const side = startFrom("left", frame);

    expect(toolbarToolOpacity(side)).toBe(1);
  });
});

describe("the bar's lift follows the highlighted zone", () => {
  const start = startFrom("bottom");

  it("rests when docked", () => {
    expect(toolbarLift(null)).toBe("rest");
  });

  it("lifts while held over a highlighted slot", () => {
    expect(toolbarLift(start)).toBe("lifted");
    expect(toolbarLift(dragTo(start, { x: 100, y: 500 }))).toBe("lifted");
  });

  it("floats flat once carried clear of every slot", () => {
    expect(toolbarLift(dragTo(start, { x: 500, y: 350 }))).toBe("floating");
  });
});

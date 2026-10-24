import { describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { ToolbarDock, ToolbarDragState, ToolbarFrame } from "../types/toolbar";
import { TOOLBAR_INSET } from "./toolbarGeometry";
import { TOOLBAR_DOCKS, poseForDock } from "./toolbarPose";
import {
  DOUBLE_PRESS_MS,
  REGION_MARGIN,
  TEAR_DISTANCE,
  nextToolbarDrag,
  releasedDock,
  startToolbarDrag,
  toolbarBarOrigin,
  toolbarLift,
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

describe("each edge claims a region of the frame", () => {
  const start = startFrom("bottom");

  it("docks to the edge whose strip the handle is in", () => {
    expect(dragTo(start, { x: 500, y: 100 }).target).toBe("top");
    expect(dragTo(start, { x: 900, y: 350 }).target).toBe("right");
    expect(dragTo(start, { x: 500, y: 600 }).target).toBe("bottom");
    // Low in the strip, so a standing bar's tip, 286px above the handle, is in the strip too.
    expect(dragTo(startFrom("right"), { x: 100, y: 450 }).target).toBe("left");
  });

  it("splits a corner on its diagonal, so a handle hugging a side edge keeps that side", () => {
    expect(dragTo(start, { x: 30, y: 120 }).target).toBe("left");
    expect(dragTo(start, { x: 600, y: 30 }).target).toBe("top");
  });

  it("targets a slot without moving or turning the bar", () => {
    const drag = dragTo(start, { x: 900, y: 350 });

    expect(drag).toMatchObject({ target: "right", seatDock: "bottom" });
    expect(drag.handle).toEqual({ x: 900, y: 350 });
  });

  it("keeps steering by region once the pointer leaves the frame", () => {
    expect(dragTo(start, { x: -200, y: 350 }).target).toBe("left");
    expect(dragTo(start, { x: 500, y: -300 }).target).toBe("top");
  });

  it("holds the handle inside the frame however far the pointer wanders", () => {
    expect(dragTo(start, { x: 5000, y: 5000 }).handle).toEqual({ x: 988, y: 688 });
  });

  it("reaches the bottom from a side even where the far end could not get there", () => {
    const frame = { width: 1000, height: 670 };
    const side = startFrom("left", frame);

    expect(dragTo(side, { x: 100, y: 660 }, frame).target).toBe("bottom");
  });
});

describe("the centre square splits across the axis of the seat the bar was carried from", () => {
  it("lets a flat bar choose between top and bottom by how high its handle is", () => {
    const start = startFrom("bottom");

    // The handle is at the far right of the square, so the bar's tip is still inside it.
    expect(dragTo(start, { x: 643, y: 300 }).target).toBe("top");
    expect(dragTo(start, { x: 655, y: 300 }).target).toBe("top");
    expect(dragTo(start, { x: 643, y: 400 }).target).toBe("bottom");
    expect(dragTo(start, { x: 655, y: 400 }).target).toBe("bottom");
  });

  it("lets a standing bar choose between left and right by how far across its handle is", () => {
    const start = startFrom("left");

    // The handle is at the bottom of the square, so the bar's tip is still inside it.
    expect(dragTo(start, { x: 400, y: 505 }).target).toBe("left");
    expect(dragTo(start, { x: 400, y: 508 }).target).toBe("left");
    expect(dragTo(start, { x: 600, y: 505 }).target).toBe("right");
    expect(dragTo(start, { x: 600, y: 508 }).target).toBe("right");
  });

  it("splits the same way from the opposite seat of the axis", () => {
    expect(dragTo(startFrom("top"), { x: 643, y: 400 }).target).toBe("bottom");
    expect(dragTo(startFrom("right"), { x: 400, y: 505 }).target).toBe("left");
  });

  it("takes a straight pull from the top to the bottom once the handle is a margin past the middle", () => {
    const seat = seatedHandle("top", FRAME);
    const start = startFrom("top");
    const middle = 350;

    expect(dragTo(start, { x: seat.x, y: middle + REGION_MARGIN - 1 }).target).toBe("top");
    expect(dragTo(start, { x: seat.x, y: middle + REGION_MARGIN }).target).toBe("bottom");
  });

  it("takes a straight pull from the left to the right once the handle is a margin past the middle", () => {
    const seat = seatedHandle("left", FRAME);
    const start = startFrom("left");
    const middle = 500;

    expect(dragTo(start, { x: middle + REGION_MARGIN - 1, y: seat.y }).target).toBe("left");
    expect(dragTo(start, { x: middle + REGION_MARGIN, y: seat.y }).target).toBe("right");
  });
});

describe("the end of the bar that leads steers", () => {
  it("turns a flat bar to the left once its far end is in the left strip, though the handle is still central", () => {
    const drag = dragTo(startFrom("bottom"), { x: 400, y: 350 });

    expect(drag.target).toBe("left");
    expect(drag.handle).toEqual({ x: 400, y: 350 });
  });

  it("waits for the handle before a flat bar goes right, since the handle leads that way", () => {
    const start = startFrom("bottom");

    // The bottom target keeps claiming for a margin past the square, which is its bottom half.
    expect(dragTo(start, { x: 643, y: 350 }).target).toBe("bottom");
    expect(dragTo(start, { x: 660 + REGION_MARGIN, y: 350 }).target).toBe("bottom");
    expect(dragTo(start, { x: 661 + REGION_MARGIN, y: 350 }).target).toBe("right");
  });

  it("turns a standing bar to the top once its far end is in the top strip, though the handle is still central", () => {
    const drag = dragTo(startFrom("left"), { x: 500, y: 300 });

    expect(drag.target).toBe("top");
    expect(drag.handle).toEqual({ x: 500, y: 300 });
  });

  it("waits for the handle before a standing bar goes to the bottom, since the handle leads that way", () => {
    const start = startFrom("left");

    expect(dragTo(start, { x: 500, y: 509 }).target).toBe("left");
    expect(dragTo(start, { x: 500, y: 511 }).target).toBe("bottom");
  });
});

describe("a corner catches the destination before the diagonal does", () => {
  it("turns a flat bar to the right while its handle is still short of the corner's diagonal", () => {
    // The handle is 130px from the right edge and 50px from the bottom: inside the catch rectangle, but below the diagonal.
    expect(dragTo(startFrom("bottom"), { x: 870, y: 650 }).target).toBe("right");
  });

  it("keeps the target for a margin after the handle enters the corner rectangle", () => {
    expect(dragTo(startFrom("bottom"), { x: 850, y: 650 }).target).toBe("bottom");
  });

  it("does not catch a handle that is well outside the corner rectangle", () => {
    expect(dragTo(startFrom("bottom"), { x: 780, y: 650 }).target).toBe("bottom");
  });

  it("turns a standing bar to the top while its handle is still short of the corner's diagonal", () => {
    expect(dragTo(startFrom("left"), { x: 50, y: 60 }).target).toBe("top");
  });
});

describe("the tip of the bar leads toward the facing sides", () => {
  // The tip is the handle reflected through the bar's centre, so it sits as far from its end as the handle does from its own.
  const TIP_REACH = LENGTH - 2 * 17;

  it("switches a flat bar to the left once its tip is a margin inside the left strip, however far back the handle is", () => {
    const start = startFrom("bottom");
    // The left strip starts at x = 340.
    const handleX = (tipX: number) => tipX + TIP_REACH;

    expect(dragTo(start, { x: handleX(340 - REGION_MARGIN - 1), y: 450 }).target).toBe("left");
    expect(dragTo(start, { x: handleX(340 - REGION_MARGIN), y: 450 }).target).toBe("bottom");
  });

  it("switches a standing bar to the top once its tip is a margin inside the top strip", () => {
    const start = startFrom("left");
    // The top strip ends at y = 190.
    const handleY = (tipY: number) => tipY + TIP_REACH;

    expect(dragTo(start, { x: 400, y: handleY(190 - REGION_MARGIN - 1) }).target).toBe("top");
    expect(dragTo(start, { x: 400, y: handleY(190 - REGION_MARGIN) }).target).toBe("left");
  });

  it("asks the tip for the same margin the handle needs toward the right", () => {
    const start = startFrom("bottom");

    // The handle must be a margin past the right strip's edge at x = 660, as the tip must be inside the left.
    expect(dragTo(start, { x: 660 + REGION_MARGIN, y: 450 }).target).toBe("bottom");
    expect(dragTo(start, { x: 661 + REGION_MARGIN, y: 450 }).target).toBe("right");
  });

  it("steers a tip past the canvas edge as it would from the edge it is past", () => {
    // The standing bar's tip is 286px above the handle, off the top of the canvas: it meets the edge at (100, 0), in the top-left corner rectangle.
    expect(dragTo(startFrom("left"), { x: 100, y: 100 }).target).toBe("top");
    // The flat bar's tip is off the left edge and meets it at (0, 400), in the left strip.
    expect(dragTo(startFrom("bottom"), { x: 150, y: 400 }).target).toBe("left");
  });

  it("keeps a bar whose tip hangs off the canvas on the edge it holds while the handle is clear of the others", () => {
    const start = startFrom("bottom");
    const onLeft = dragTo(start, { x: 150, y: 400 });

    expect(dragTo(onLeft, { x: 150, y: 420 }).target).toBe("left");
    expect(dragTo(onLeft, { x: 150, y: 380 }).target).toBe("left");
  });
});

describe("the far end takes the bar while the handle is still in the current region", () => {
  it("turns a standing bar to the top while its handle is still in the left strip", () => {
    const drag = dragTo(startFrom("left"), { x: 250, y: 243 });

    expect(drag.target).toBe("top");
    expect(dragTo(startFrom("left"), { x: 250, y: 460 }).target).toBe("left");
  });

  it("turns a flat bar to the left while its handle is still in the bottom strip", () => {
    const drag = dragTo(startFrom("bottom"), { x: 430, y: 600 });

    expect(drag.target).toBe("left");
    expect(dragTo(startFrom("bottom"), { x: 450, y: 600 }).target).toBe("bottom");
  });
});

describe("the bar is steered by where its handle is drawn, not by the pointer", () => {
  const seat = seatedHandle("bottom", FRAME);
  // The pointer holds the bar 30px to the right of its handle.
  const start = startToolbarDrag({
    dock: "bottom",
    length: LENGTH,
    pointer: nudged(seat, 30, 0),
    handle: seat,
    handleInBar: handleInBar("bottom"),
    frame: FRAME,
  });

  it("stays on the target while the handle is in the centre square and the pointer is not", () => {
    const drag = dragTo(start, { x: 690, y: 350 });

    expect(drag.handle).toEqual({ x: 660, y: 350 });
    expect(drag.target).toBe("bottom");
  });

  it("changes the target once the handle itself is a margin past the square", () => {
    // The pointer is 30px right of the handle, so the handle is at pointer.x - 30.
    expect(dragTo(start, { x: 690 + REGION_MARGIN, y: 350 }).target).toBe("bottom");
    expect(dragTo(start, { x: 691 + REGION_MARGIN, y: 350 }).target).toBe("right");
  });
});

describe("a region stays with the target until the handle is clearly past it", () => {
  const start = startFrom("bottom");
  // The top-right corner is 340 wide and 190 tall; its diagonal runs y = 190/340 * (1000 - x).
  const onTop = dragTo(start, { x: 800, y: 106 });
  const onRight = dragTo(start, { x: 800, y: 150 });

  it("keeps the top across the diagonal until the handle is clear of it", () => {
    expect(dragTo(onTop, { x: 800, y: 118 }).target).toBe("top");
    expect(dragTo(onTop, { x: 800, y: 140 }).target).toBe("right");
  });

  it("keeps the right across the diagonal until the handle is clear of it", () => {
    expect(dragTo(onRight, { x: 800, y: 106 }).target).toBe("right");
    expect(dragTo(onRight, { x: 800, y: 60 }).target).toBe("top");
  });

  it("holds the target when the pointer shakes across the diagonal", () => {
    const targets = new Set<ToolbarDock>();
    let drag = onTop;

    for (let step = 0; step < 12; step++) {
      drag = dragTo(drag, { x: 800, y: step % 2 === 0 ? 118 : 106 });
      targets.add(drag.target);
    }

    expect([...targets]).toEqual(["top"]);
  });
});

describe("holding the pointer still settles on one target", () => {
  const step = 50;

  function pointerGrid(frame: ToolbarFrame): Point2D[] {
    const points: Point2D[] = [];

    for (let y = step / 2; y < frame.height; y += step) {
      for (let x = step / 2; x < frame.width; x += step) points.push({ x, y });
    }

    return points;
  }

  /** Re-applies the same pointer and returns every pointer where the target still changes. */
  function unsettledPointers(
    seat: ToolbarDock,
    previousTarget: ToolbarDock,
    frame: ToolbarFrame,
  ): Point2D[] {
    const loose: ToolbarDragState = {
      ...startFrom(seat, frame),
      tether: null,
      target: previousTarget,
    };

    return pointerGrid(frame).filter((pointer) => {
      const first = dragTo(loose, pointer, frame);
      const second = dragTo(first, pointer, frame);
      const third = dragTo(second, pointer, frame);

      return first.target !== second.target || second.target !== third.target;
    });
  }

  const frames: ToolbarFrame[] = [
    FRAME,
    { width: 1440, height: 800 },
    { width: 700, height: 600 },
    { width: 600, height: 900 },
    { width: 1800, height: 500 },
    { width: 1000, height: 300 },
  ];

  for (const frame of frames) {
    for (const seat of TOOLBAR_DOCKS) {
      for (const previousTarget of TOOLBAR_DOCKS) {
        it(`from a ${seat} seat that targeted ${previousTarget}, in ${frame.width}x${frame.height}`, () => {
          expect(unsettledPointers(seat, previousTarget, frame)).toEqual([]);
        });
      }
    }
  }
});

describe("every edge can be reached from every other", () => {
  /** A point well inside each edge's strip and away from any corner. */
  const inStrip: Record<ToolbarDock, Point2D> = {
    top: { x: 500, y: 40 },
    bottom: { x: 500, y: 660 },
    // Low in the side strips, so a standing bar's tip is in the strip as well.
    left: { x: 40, y: 480 },
    right: { x: 960, y: 480 },
  };

  for (const seat of TOOLBAR_DOCKS) {
    for (const destination of TOOLBAR_DOCKS) {
      it(`from a ${seat} seat to ${destination}`, () => {
        const drag = dragTo(startFrom(seat), inStrip[destination]);

        expect(drag.target).toBe(destination);
      });
    }
  }
});

describe("a straight pull from one seat to another changes the target once", () => {
  const steps = 200;

  function pull(seat: ToolbarDock, destination: ToolbarDock, frame: ToolbarFrame) {
    const from = seatedHandle(seat, frame);
    const to = seatedHandle(destination, frame);
    let drag = startFrom(seat, frame);
    let changes = 0;

    for (let step = 1; step <= steps; step++) {
      const pointer = {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
      };
      const next = dragTo(drag, pointer, frame);
      if (next.target !== drag.target) changes += 1;
      drag = next;
    }

    return { changes, final: drag.target };
  }

  // The narrow and the wide frames put the bar's far end off the canvas part-way through a pull.
  const frames = [
    FRAME,
    { width: 1440, height: 800 },
    { width: 600, height: 900 },
    { width: 1800, height: 500 },
  ];

  for (const frame of frames) {
    for (const seat of TOOLBAR_DOCKS) {
      for (const destination of TOOLBAR_DOCKS) {
        if (seat === destination) continue;

        it(`${seat} to ${destination}, in ${frame.width}x${frame.height}`, () => {
          expect(pull(seat, destination, frame)).toEqual({ changes: 1, final: destination });
        });
      }
    }
  }
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
    expect(dragTo(start, { x: 50, y: 200 }, frame).target).toBe("bottom");
    expect(dragTo(start, { x: 50, y: 100 }, frame).target).toBe("top");
  });

  it("leaves a side target it held before the frame shrank", () => {
    const wasTall: ToolbarDragState = { ...start, tether: null, target: "left" };

    expect(dragTo(wasTall, { x: 50, y: 200 }, frame).target).toBe("bottom");
    expect(dragTo(wasTall, { x: 50, y: 100 }, frame).target).toBe("top");
  });

  it("settles on the half the pointer is in when the frame shrinks under a held side target", () => {
    const tall = dragTo(start, { x: 400, y: 350 }, FRAME);
    const shrunk = dragTo(tall, { x: 400, y: 100 }, frame);

    expect(tall.target).toBe("left");
    expect(shrunk.target).toBe("top");
    expect(dragTo(shrunk, { x: 400, y: 100 }, frame).target).toBe("top");
  });

  it("keeps the bar in its slot when the frame resizes before it has torn loose", () => {
    const resized = dragTo(start, start.pointer, frame);

    expect(resized.tether).not.toBeNull();
    expect(resized.target).toBe(start.target);
    expect(resized.frame).toEqual(frame);
  });
});

describe("the bar's lift", () => {
  it("rests when docked", () => {
    expect(toolbarLift(null)).toBe("rest");
  });

  it("lifts for the whole drag", () => {
    const start = startFrom("bottom");

    expect(toolbarLift(start)).toBe("lifted");
    expect(toolbarLift(dragTo(start, { x: 500, y: 350 }))).toBe("lifted");
  });
});

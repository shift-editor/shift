import { describe, expect, it } from "vitest";
import type { ToolbarDock } from "../types/toolbar";
import {
  centreSquare,
  clampHandleToFrame,
  centreHalfPolygon,
  dockRegionAt,
  dockRegionPolygon,
} from "./toolbarGeometry";

const FRAME = { width: 1000, height: 700 };
const LENGTH = 320;

describe("keeping the handle inside the frame", () => {
  it("holds a handle that strays out at the inset", () => {
    expect(clampHandleToFrame({ x: 5000, y: -40 }, FRAME)).toEqual({ x: 988, y: 12 });
  });

  it("leaves a handle alone in a frame too small to inset it", () => {
    const handle = { x: 30, y: 5 };

    expect(clampHandleToFrame(handle, { width: 20, height: 20 })).toEqual(handle);
  });

  it("leaves a handle alone when it is inside", () => {
    const handle = { x: 600, y: 300 };

    expect(clampHandleToFrame(handle, FRAME)).toEqual(handle);
  });
});

describe("the centre square", () => {
  it("is as wide as the bar is long, centred in the frame", () => {
    expect(centreSquare(FRAME, LENGTH)).toMatchObject({
      left: 340,
      top: 190,
      right: 660,
      bottom: 510,
    });
  });

  it("shrinks to four fifths of a frame side that is not much longer than the bar", () => {
    const frame = { width: 1000, height: 360 };

    expect(centreSquare(frame, LENGTH)).toMatchObject({
      left: 356,
      top: 36,
      right: 644,
      bottom: 324,
    });
  });
});

describe("which dock a point belongs to", () => {
  const at = (x: number, y: number, seat: ToolbarDock = "bottom") =>
    dockRegionAt({ x, y }, FRAME, LENGTH, false, seat);

  it("gives the strip above, below and beside the centre square to that edge", () => {
    expect(at(500, 100)).toBe("top");
    expect(at(500, 600)).toBe("bottom");
    expect(at(100, 350)).toBe("left");
    expect(at(900, 350)).toBe("right");
  });

  it("splits the centre square across the axis of the seat the bar was carried from", () => {
    // The square spans x 340-660 and y 190-510, so its midlines are x = 500 and y = 350.
    expect(at(499, 190, "left")).toBe("left");
    expect(at(501, 190, "left")).toBe("right");
    expect(at(499, 510, "right")).toBe("left");
    expect(at(501, 510, "right")).toBe("right");
    expect(at(340, 349, "top")).toBe("top");
    expect(at(340, 351, "top")).toBe("bottom");
    expect(at(660, 349, "bottom")).toBe("top");
    expect(at(660, 351, "bottom")).toBe("bottom");
  });

  it("gives a point on the midline to the right or bottom half", () => {
    expect(at(500, 350, "left")).toBe("right");
    expect(at(500, 350, "top")).toBe("bottom");
  });

  it("ignores the other axis inside the centre square", () => {
    expect(at(345, 195, "left")).toBe("left");
    expect(at(655, 505, "left")).toBe("right");
    expect(at(345, 505, "bottom")).toBe("bottom");
    expect(at(655, 195, "bottom")).toBe("top");
  });

  it("leaves the regions outside the centre square the same whatever the seat", () => {
    for (const seat of ["top", "bottom", "left", "right"] as const) {
      expect(at(500, 100, seat)).toBe("top");
      expect(at(100, 350, seat)).toBe("left");
      expect(at(200, 112, seat)).toBe("left");
    }
  });

  it("splits each corner on its diagonal, by the edge the point is proportionally nearer", () => {
    // The top-left corner is 340 wide and 190 tall, so its diagonal runs y = 190/340 * x.
    expect(at(30, 120)).toBe("left");
    expect(at(300, 30)).toBe("top");
    expect(at(200, 111)).toBe("top");
    expect(at(200, 112)).toBe("left");
  });

  it("splits all four corners alike", () => {
    expect(at(970, 120)).toBe("right");
    expect(at(700, 30)).toBe("top");
    expect(at(30, 580)).toBe("left");
    expect(at(300, 670)).toBe("bottom");
    expect(at(970, 580)).toBe("right");
    expect(at(700, 670)).toBe("bottom");
  });

  it("gives a point exactly on a diagonal to the top or bottom edge", () => {
    expect(at(170, 95)).toBe("top");
    expect(at(170, 605)).toBe("bottom");
  });

  it("lets a corner catch the edge across the seat's axis in a rectangle short of the diagonal", () => {
    // Half of the 340 by 190 corner rectangle is 170 by 95, and its far corner lies on the diagonal.
    expect(at(100, 50, "bottom")).toBe("left");
    expect(at(169, 94, "bottom")).toBe("left");
    expect(at(900, 50, "bottom")).toBe("right");
    expect(at(100, 650, "top")).toBe("left");
    expect(at(900, 650, "top")).toBe("right");
    expect(at(50, 90, "left")).toBe("top");
    expect(at(950, 90, "right")).toBe("top");
    expect(at(50, 610, "left")).toBe("bottom");
    expect(at(950, 610, "right")).toBe("bottom");
  });

  it("falls back to the diagonal just outside the corner rectangle", () => {
    expect(at(171, 94, "bottom")).toBe("top");
    expect(at(169, 96, "bottom")).toBe("left");
    expect(at(51, 96, "left")).toBe("left");
    expect(at(171, 94, "left")).toBe("top");
  });

  it("gives the same corner to the same edge whatever the carried bar's direction along its axis", () => {
    expect(at(100, 50, "bottom")).toBe(at(100, 50, "top"));
    expect(at(50, 90, "left")).toBe(at(50, 90, "right"));
  });

  it("keeps assigning points beyond the frame to the edge they lie past", () => {
    expect(at(-300, 350)).toBe("left");
    expect(at(500, -300)).toBe("top");
    expect(at(2000, 350)).toBe("right");
    expect(at(500, 2000)).toBe("bottom");
    expect(at(-50, -50, "left")).toBe("top");
    expect(at(-50, -50, "bottom")).toBe("left");
  });

  it("splits a frame that only holds a flat bar into a top half and a bottom half", () => {
    const frame = { width: 1000, height: 300 };

    expect(dockRegionAt({ x: 50, y: 149 }, frame, LENGTH, true, "bottom")).toBe("top");
    expect(dockRegionAt({ x: 50, y: 151 }, frame, LENGTH, true, "bottom")).toBe("bottom");
    expect(dockRegionAt({ x: 500, y: 150 }, frame, LENGTH, true, "bottom")).toBe("bottom");
  });
});

describe("the drawn regions", () => {
  it("outline the four trapezoids around the centre square, with the corner rectangles moved to the edges across the seat's axis", () => {
    const polygon = (dock: ToolbarDock, seat: ToolbarDock) =>
      dockRegionPolygon(dock, FRAME, LENGTH, false, seat);

    // A flat bar's corners go to the left and right edges, so those two edges take the corner rectangles.
    expect(polygon("top", "bottom")).toEqual([
      { x: 170, y: 0 },
      { x: 830, y: 0 },
      { x: 830, y: 95 },
      { x: 660, y: 190 },
      { x: 340, y: 190 },
      { x: 170, y: 95 },
    ]);
    expect(polygon("left", "bottom")).toEqual([
      { x: 0, y: 0 },
      { x: 170, y: 0 },
      { x: 170, y: 95 },
      { x: 340, y: 190 },
      { x: 340, y: 510 },
      { x: 170, y: 605 },
      { x: 170, y: 700 },
      { x: 0, y: 700 },
    ]);
    // A standing bar's corners go to the top and bottom edges.
    expect(polygon("top", "left")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 95 },
      { x: 170, y: 95 },
      { x: 340, y: 190 },
      { x: 660, y: 190 },
      { x: 830, y: 95 },
      { x: 1000, y: 95 },
      { x: 1000, y: 0 },
    ]);
    expect(polygon("left", "left")).toEqual([
      { x: 0, y: 95 },
      { x: 170, y: 95 },
      { x: 340, y: 190 },
      { x: 340, y: 510 },
      { x: 170, y: 605 },
      { x: 0, y: 605 },
    ]);
  });

  it("mirror for the bottom and right edges", () => {
    expect(dockRegionPolygon("bottom", FRAME, LENGTH, false, "left")).toEqual([
      { x: 0, y: 700 },
      { x: 0, y: 605 },
      { x: 170, y: 605 },
      { x: 340, y: 510 },
      { x: 660, y: 510 },
      { x: 830, y: 605 },
      { x: 1000, y: 605 },
      { x: 1000, y: 700 },
    ]);
    expect(dockRegionPolygon("right", FRAME, LENGTH, false, "bottom")).toEqual([
      { x: 1000, y: 0 },
      { x: 830, y: 0 },
      { x: 830, y: 95 },
      { x: 660, y: 190 },
      { x: 660, y: 510 },
      { x: 830, y: 605 },
      { x: 830, y: 700 },
      { x: 1000, y: 700 },
    ]);
  });

  it("outline halves of the frame when it only holds a flat bar", () => {
    const frame = { width: 1000, height: 300 };

    expect(dockRegionPolygon("bottom", frame, LENGTH, true, "bottom")).toEqual([
      { x: 0, y: 150 },
      { x: 1000, y: 150 },
      { x: 1000, y: 300 },
      { x: 0, y: 300 },
    ]);
  });

  it("outline the two halves of the centre square for the seat's axis", () => {
    expect(centreHalfPolygon("left", FRAME, LENGTH, "right")).toEqual([
      { x: 340, y: 190 },
      { x: 500, y: 190 },
      { x: 500, y: 510 },
      { x: 340, y: 510 },
    ]);
    expect(centreHalfPolygon("bottom", FRAME, LENGTH, "top")).toEqual([
      { x: 340, y: 350 },
      { x: 660, y: 350 },
      { x: 660, y: 510 },
      { x: 340, y: 510 },
    ]);
  });

  it("give no half to a dock on the other axis from the seat", () => {
    expect(centreHalfPolygon("top", FRAME, LENGTH, "left")).toEqual([]);
    expect(centreHalfPolygon("right", FRAME, LENGTH, "bottom")).toEqual([]);
  });
});

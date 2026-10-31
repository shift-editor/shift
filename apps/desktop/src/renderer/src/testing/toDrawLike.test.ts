import { describe, expect, it } from "vitest";
import type { ContourId, PointId } from "@shift/types";
import type { Outline } from "./reads";

const triangle: Outline = [
  {
    id: "c1" as ContourId,
    closed: true,
    points: [
      { id: "p1" as PointId, x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: "p2" as PointId, x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: "p3" as PointId, x: 50, y: 80, pointType: "offCurve", smooth: false },
    ],
  },
];

const redrawn: Outline = [
  {
    id: "c9" as ContourId,
    closed: true,
    points: [
      { id: "p7" as PointId, x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: "p8" as PointId, x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: "p9" as PointId, x: 50, y: 80, pointType: "offCurve", smooth: false },
    ],
  },
];

describe("toDrawLike", () => {
  it("passes an outline that draws the same contours and points under other ids", () => {
    expect(redrawn).toDrawLike(triangle);
  });

  it("fails an outline that starts at another point or runs the other way", () => {
    const [contour] = triangle;
    const points = contour!.points;
    expect([{ ...contour!, points: [points[1]!, points[2]!, points[0]!] }]).not.toDrawLike(
      triangle,
    );
    expect([{ ...contour!, points: [...points].reverse() }]).not.toDrawLike(triangle);
  });

  it("fails an outline whose contour closes differently or whose point is another type or smoothness", () => {
    const [contour] = triangle;
    const [first, second, third] = contour!.points;
    expect([{ ...contour!, closed: false }]).not.toDrawLike(triangle);
    expect([
      { ...contour!, points: [first!, second!, { ...third!, pointType: "onCurve" }] },
    ]).not.toDrawLike(triangle);
    expect([
      { ...contour!, points: [first!, { ...second!, smooth: true }, third!] },
    ]).not.toDrawLike(triangle);
  });

  it("fails anything that is not an outline", () => {
    expect(null).not.toDrawLike(triangle);
    expect([{ points: [] }]).not.toDrawLike(triangle);
  });

  it("matches an outline nested in what another matcher compares", () => {
    expect({ outline: redrawn }).toEqual({ outline: expect.toDrawLike(triangle) });
  });

  it("names the first contour or point that differs", () => {
    const [contour] = triangle;
    const [first, second, third] = contour!.points;
    const moved = [{ ...contour!, points: [first!, { ...second!, x: 90 }, third!] }];

    expect(() => expect(moved).toDrawLike(triangle)).toThrow(
      "expected the outline to draw like the expected outline, but contour 0 point 1 is { x: 90, y: 0, pointType: onCurve, smooth: false }, not { x: 100, y: 0, pointType: onCurve, smooth: false }",
    );
    expect(() => expect([]).toDrawLike(triangle)).toThrow("it has 0 contours, not 1");
    expect(() => expect([{ ...contour!, closed: false }]).toDrawLike(triangle)).toThrow(
      "contour 0 is open, not closed",
    );
  });
});

import { describe, expect, it } from "vitest";
import { Point } from "./Point";
import { parseContourSegments } from "./parseContourSegments";

const points = [
  Point.onCurve({ x: 0, y: 0 }),
  Point.onCurve({ x: 10, y: 0 }),
  Point.offCurve({ x: 15, y: 10 }),
  Point.create({ x: 20, y: 0 }, "qCurve", true),
  Point.offCurve({ x: 25, y: -10 }),
  Point.offCurve({ x: 35, y: 10 }),
  Point.onCurve({ x: 40, y: 0 }),
];

describe("contour traversal without authored identity", () => {
  it("parses mixed lines, quadratics, and cubics while retaining point references", () => {
    const segments = parseContourSegments({ points, closed: false });
    expect(segments).toEqual([
      { type: "line", start: points[0], end: points[1] },
      { type: "quad", start: points[1], control: points[2], end: points[3] },
      {
        type: "cubic",
        start: points[3],
        controlStart: points[4],
        controlEnd: points[5],
        end: points[6],
      },
    ]);
    expect(segments[0].start).toBe(points[0]);
    expect(segments[2].end).toBe(points[6]);
  });

  it("adds the closing line only for closed contours", () => {
    const segments = parseContourSegments({ points, closed: true });
    expect(segments).toHaveLength(4);
    expect(segments.at(-1)).toEqual({ type: "line", start: points[6], end: points[0] });
  });

  it("wraps leading controls into the closing cubic", () => {
    const points = [
      Point.offCurve({ x: 0, y: 100 }),
      Point.offCurve({ x: 100, y: 100 }),
      Point.onCurve({ x: 100, y: 0 }),
      Point.onCurve({ x: 0, y: 0 }),
    ];
    expect(parseContourSegments({ points, closed: true })).toEqual([
      { type: "line", start: points[2], end: points[3] },
      {
        type: "cubic",
        start: points[3],
        controlStart: points[0],
        controlEnd: points[1],
        end: points[2],
      },
    ]);
    expect(parseContourSegments({ points, closed: false })).toEqual([
      { type: "line", start: points[2], end: points[3] },
    ]);
  });

  it("wraps trailing controls to the initial anchor", () => {
    const points = [
      Point.onCurve({ x: 0, y: 0 }),
      Point.onCurve({ x: 100, y: 0 }),
      Point.offCurve({ x: 100, y: 100 }),
      Point.offCurve({ x: 0, y: 100 }),
    ];
    expect(parseContourSegments({ points, closed: true }).at(-1)).toEqual({
      type: "cubic",
      start: points[1],
      controlStart: points[2],
      controlEnd: points[3],
      end: points[0],
    });
    expect(parseContourSegments({ points, closed: false })).toHaveLength(1);
  });

  it("preserves existing malformed-run traversal rather than silently dropping it", () => {
    const points = [
      Point.onCurve({ x: 0, y: 0 }),
      Point.offCurve({ x: 10, y: 20 }),
      Point.offCurve({ x: 20, y: 20 }),
      Point.offCurve({ x: 30, y: 0 }),
    ];
    expect(parseContourSegments({ points, closed: false })).toEqual([
      {
        type: "cubic",
        start: points[0],
        controlStart: points[1],
        controlEnd: points[2],
        end: points[3],
      },
    ]);
  });

  it.each([{ points: [] }, { points: [Point.onCurve({ x: 0, y: 0 })] }])(
    "leaves insufficient geometry empty: %j",
    ({ points }) => {
      expect(parseContourSegments({ points, closed: true })).toEqual([]);
      expect(parseContourSegments({ points, closed: false })).toEqual([]);
    },
  );
});

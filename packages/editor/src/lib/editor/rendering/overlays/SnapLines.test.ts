import { describe, expect, it } from "vitest";
import { snapFeedback } from "./SnapLines";
import type { PositionGuide } from "../../../../types/positionEdit";

const alignment = (target: { x: number; y: number }, point: { x: number; y: number }) =>
  ({ kind: "alignment", target, point }) as const satisfies PositionGuide;

describe("snap feedback crosses the positions its guide lines pass through", () => {
  it("crosses a crossing on a vertical alignment line's span, not one past its end or beside it", () => {
    const feedback = snapFeedback(
      [alignment({ x: 100, y: 0 }, { x: 100, y: 300 })],
      [
        { x: 100, y: 120 },
        { x: 100 + 1e-7, y: 200 },
        { x: 100 - 1e-7, y: 250 },
        { x: 100, y: 400 },
        { x: 101, y: 150 },
      ],
    );

    // Crosses draw in no particular order.
    expect(feedback.markers).toHaveLength(5);
    expect(feedback.markers).toEqual(
      expect.arrayContaining([
        { x: 100, y: 0 },
        { x: 100, y: 300 },
        { x: 100, y: 120 },
        { x: 100 + 1e-7, y: 200 },
        { x: 100 - 1e-7, y: 250 },
      ]),
    );
  });

  it("crosses a crossing on a metric span", () => {
    const feedback = snapFeedback(
      [
        { kind: "metric", metric: "baseline", x: 10, y: 0 },
        { kind: "metric", metric: "baseline", x: 90, y: 0 },
      ],
      [
        { x: 50, y: 0 },
        { x: 50, y: 1 },
      ],
    );

    expect(feedback.lines).toEqual([
      [
        { x: 10, y: 0 },
        { x: 90, y: 0 },
      ],
    ]);
    expect(feedback.markers).toEqual([
      { x: 10, y: 0 },
      { x: 90, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("draws a line repeated by several guides once", () => {
    const guide = alignment({ x: 0, y: 0 }, { x: 0, y: 50 });
    const feedback = snapFeedback([
      guide,
      { ...guide },
      alignment({ x: 0, y: 0 }, { x: 0, y: 80 }),
    ]);

    expect(feedback.lines).toEqual([
      [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 80 },
      ],
    ]);
  });
});

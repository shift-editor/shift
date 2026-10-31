import { describe, expect, it } from "vitest";
import { byAxis } from "./order";

describe("byAxis", () => {
  const points = [
    { x: 30, y: 5 },
    { x: 10, y: 20 },
    { x: 20, y: -4 },
  ];

  it("orders points left to right on x", () => {
    expect(points.toSorted(byAxis("x")).map(({ x }) => x)).toEqual([10, 20, 30]);
  });

  it("orders points bottom to top on y", () => {
    expect(points.toSorted(byAxis("y")).map(({ y }) => y)).toEqual([-4, 5, 20]);
  });
});

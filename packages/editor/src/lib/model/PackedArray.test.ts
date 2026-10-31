import { describe, expect, it } from "vitest";
import { PackedArray } from "./PackedArray";

describe("packed arrays preserve logical record boundaries", () => {
  it("reverses records without reversing their components", () => {
    const coordinates = new PackedArray(2, new Float64Array([10, 20, 30, 40, 50, 60]));

    coordinates.reverse();

    expect([...coordinates.view]).toEqual([50, 60, 30, 40, 10, 20]);
  });

  it("grows and splices in logical record units", () => {
    const coordinates = new PackedArray(2, new Float64Array([10, 20, 50, 60]));

    coordinates.splice(1, 0, [30, 40]);
    coordinates.splice(0, 1);

    expect(coordinates.length).toBe(2);
    expect([...coordinates.view]).toEqual([30, 40, 50, 60]);
  });

  it("sets one record without exposing scalar offsets", () => {
    const coordinates = new PackedArray(2, new Float64Array([10, 20, 30, 40]));

    coordinates.setItem(1, [75, 125]);

    expect(coordinates.getComponent(1, 0)).toBe(75);
    expect(coordinates.getComponent(1, 1)).toBe(125);
  });
});

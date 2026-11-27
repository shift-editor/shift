import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { StrokeOffsetFields } from "@/types/stroke";
import {
  DEFAULT_OFFSET_FIELDS,
  offsetContourFromFields,
  readOffsetInput,
} from "./strokeOffsetInput";

function fields(overrides: Partial<StrokeOffsetFields> = {}): StrokeOffsetFields {
  return { ...DEFAULT_OFFSET_FIELDS, ...overrides };
}

describe("reading the Offset Contour dialog", () => {
  it("reads the starting fields as a ready offset", () => {
    expect(readOffsetInput(DEFAULT_OFFSET_FIELDS)).toEqual({
      kind: "ready",
      request: { distance: 10, join: "round", miterLimit: 4 },
    });
  });

  it("keeps the sign of the distance, which picks the side of the path", () => {
    expect(readOffsetInput(fields({ distance: "-12.5" }))).toMatchObject({
      kind: "ready",
      request: { distance: -12.5 },
    });
    expect(readOffsetInput(fields({ distance: "+8" }))).toMatchObject({
      kind: "ready",
      request: { distance: 8 },
    });
  });

  it("accepts a typographic minus and surrounding spaces", () => {
    expect(readOffsetInput(fields({ distance: " −20 " }))).toMatchObject({
      kind: "ready",
      request: { distance: -20 },
    });
  });

  it.each([
    ["", "Enter a distance."],
    ["   ", "Enter a distance."],
    ["abc", "The distance must be a number."],
    ["1e999", "The distance must be a number."],
    ["0", "The distance cannot be zero: it would not move the contour."],
    ["-0", "The distance cannot be zero: it would not move the contour."],
  ])("refuses the distance %j with a reason", (distance, problem) => {
    expect(readOffsetInput(fields({ distance }))).toEqual({ kind: "invalid", problem });
  });

  it("reads the miter limit only while the join is miter", () => {
    expect(readOffsetInput(fields({ join: "miter", miterLimit: "2.5" }))).toMatchObject({
      kind: "ready",
      request: { join: "miter", miterLimit: 2.5 },
    });
    expect(readOffsetInput(fields({ join: "round", miterLimit: "nonsense" }))).toMatchObject({
      kind: "ready",
      request: { join: "round", miterLimit: 4 },
    });
  });

  it.each([
    ["", "Enter a miter limit."],
    ["x", "The miter limit must be a number."],
    ["0.5", "The miter limit must be at least 1."],
    ["-3", "The miter limit must be at least 1."],
  ])("refuses the miter limit %j with a reason when the join is miter", (miterLimit, problem) => {
    expect(readOffsetInput(fields({ join: "miter", miterLimit }))).toEqual({
      kind: "invalid",
      problem,
    });
  });
});

describe("applying the Offset Contour dialog", () => {
  const editor = useTestEditor();

  /** Draws one open line left to right at y = 100 and selects it. */
  async function drawSelectedLine() {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    editor.selectTool("select");

    const [line] = await editor.outline();
    editor.select([line!.points[0]!.id as PointId]);

    return line!;
  }

  it("moves the contour to the right of its direction for a positive distance, in one undo step", async () => {
    const line = await drawSelectedLine();

    const result = offsetContourFromFields(editor.asEditor(), fields({ distance: "25" }));
    await editor.settle();

    expect(result).toEqual({ ok: true });
    const [offset] = await editor.outline();
    for (const point of offset!.points) expect(point.y).toBeCloseTo(75, 3);

    await editor.undo();

    expect(await editor.outline()).toEqual([line]);
  });

  it("moves it to the left for a negative distance", async () => {
    await drawSelectedLine();

    offsetContourFromFields(editor.asEditor(), fields({ distance: "-25" }));
    await editor.settle();

    const [offset] = await editor.outline();
    for (const point of offset!.points) expect(point.y).toBeCloseTo(125, 3);
  });

  it("refuses a field it cannot read with the problem, and leaves the contour alone", async () => {
    const line = await drawSelectedLine();

    const result = offsetContourFromFields(editor.asEditor(), fields({ distance: "far" }));
    await editor.settle();

    expect(result).toEqual({ ok: false, reason: "The distance must be a number." });
    expect(await editor.outline()).toEqual([line]);
  });

  it("refuses with the selection's reason when no contour is selected", async () => {
    await drawSelectedLine();
    editor.select([]);

    const result = offsetContourFromFields(editor.asEditor(), DEFAULT_OFFSET_FIELDS);

    expect(result).toEqual({ ok: false, reason: "Select a contour first." });
  });
});

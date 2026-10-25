import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { objectIsKindOf } from "@shift/editor/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { TestEditor } from "@/testing/TestEditor";

describe("glyph handles keep source styling apart from interpolated locations", () => {
  let editor: TestEditor;
  let pointIds: readonly PointId[];

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    pointIds = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]);
    editor.selectTool("select");
  });

  it("draws every handle with selection styling at a source location", () => {
    editor.selection.select([pointIds[1]!]);

    expect([...editor.handleStates()]).toEqual([
      [pointIds[0], "idle"],
      [pointIds[1], "selected"],
      [pointIds[2], "idle"],
    ]);
  });

  it("draws every point of a selected contour as selected", () => {
    const point = editor.object(pointIds[0]!);
    if (!objectIsKindOf(point, "point")) throw new Error("Expected point object");

    editor.selection.select([point.contourId]);

    expect([...editor.handleStates().values()]).toEqual(["selected", "selected", "selected"]);
  });

  it("keeps drawing every handle with interpolated styling between sources", async () => {
    editor.selection.select([pointIds[1]!]);
    const axisId = editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await editor.settle();

    editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 550 }));
    expect(editor.activeSourceId).toBeNull();
    expect([...editor.handleStates().values()]).toEqual([
      "interpolated",
      "interpolated",
      "interpolated",
    ]);

    editor.selectSource(editor.font.defaultSource.id);
    expect(editor.handleStates().get(pointIds[1]!)).toBe("selected");
  });
});

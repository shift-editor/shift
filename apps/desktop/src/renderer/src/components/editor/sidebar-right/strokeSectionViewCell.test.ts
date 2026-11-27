import { describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import { applyDynamicStroke, updateStrokeStyle } from "@/lib/commands/strokeCommands";
import { strokeSectionViewCell } from "./strokeSectionModel";

describe("the Stroke section's view of the editor", () => {
  const editor = useTestEditor();

  async function drawSelectedLine(): Promise<void> {
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 400, y: 100 });
    await editor.pressKey("Escape");
    editor.selectTool("select");
    const [line] = await editor.outline();
    editor.select([line!.points[0]!.id as PointId]);
  }

  it("is hidden until a contour is selected", () => {
    expect(strokeSectionViewCell(editor.asEditor()).value).toBeNull();
  });

  it("follows adding a stroke and changing it, without being asked again", async () => {
    await drawSelectedLine();
    const cell = strokeSectionViewCell(editor.asEditor());
    expect(cell.value).toMatchObject({ canAdd: true, hasStroke: false });

    applyDynamicStroke(editor.asEditor());
    await editor.settle();
    expect(cell.value).toMatchObject({ canAdd: false, hasStroke: true, width: 20 });

    updateStrokeStyle(editor.asEditor(), { width: 44, position: -0.5 });
    await editor.settle();
    expect(cell.value).toMatchObject({ width: 44, positionPercent: -50 });

    await editor.undo();
    expect(cell.value).toMatchObject({ width: 20, positionPercent: 0 });
  });

  it("is hidden again when the selection is cleared", async () => {
    await drawSelectedLine();
    const cell = strokeSectionViewCell(editor.asEditor());
    expect(cell.value).not.toBeNull();

    editor.select([]);

    expect(cell.value).toBeNull();
  });
});

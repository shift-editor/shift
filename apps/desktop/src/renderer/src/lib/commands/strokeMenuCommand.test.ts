import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import { appNotificationCell } from "@/lib/notifications/notify";

async function drawSelectedLine(editor: EditorTestSurface) {
  editor.selectTool("pen");
  await editor.clickAt({ x: 100, y: 100 });
  await editor.clickAt({ x: 400, y: 100 });
  await editor.pressKey("Escape");
  editor.selectTool("select");

  const [line] = await editor.outline();
  editor.select([line!.points[0]!.id as PointId]);

  return line!;
}

describe("stroke commands run from the menu", () => {
  const editor = useTestEditor();

  beforeEach(() => {
    appNotificationCell.set(null);
  });

  it("applies a dynamic stroke, then expands it into closed fills", async () => {
    const line = await drawSelectedLine(editor);

    expect(await editor.runCommand("glyph.stroke.applyDynamic")).toBe(true);
    expect(await editor.runCommand("glyph.stroke.expand")).toBe(true);

    const outline = await editor.outline();
    expect(outline.map((contour) => contour.id)).not.toContain(line.id);
    expect(outline.every((contour) => contour.closed)).toBe(true);
    expect(appNotificationCell.peek()).toBeNull();
  });

  it("tells the user why a command that cannot run did nothing, and leaves the document alone", async () => {
    const line = await drawSelectedLine(editor);

    const handled = await editor.runCommand("glyph.stroke.expand");

    expect(handled).toBe(false);
    expect(appNotificationCell.peek()).toEqual({
      message: "None of the selected contours has a dynamic stroke.",
    });
    expect(await editor.outline()).toEqual([line]);
  });

  it("says to select a contour first when nothing is selected", async () => {
    await drawSelectedLine(editor);
    editor.select([]);

    expect(await editor.runCommand("glyph.stroke.applyDynamic")).toBe(false);
    expect(appNotificationCell.peek()).toEqual({ message: "Select a contour first." });
  });

  it("refuses an open contour for offset, and says so", async () => {
    await drawSelectedLine(editor);

    expect(await editor.runCommand("glyph.stroke.offsetContour")).toBe(false);
    expect(appNotificationCell.peek()).toEqual({ message: "Offset needs a closed contour." });
  });
});

describe("stroke commands run in a preview session", () => {
  const editor = useTestEditor({ mode: "preview" });

  it("tells the user the font is read-only", async () => {
    appNotificationCell.set(null);

    expect(await editor.runCommand("glyph.stroke.removeDynamic")).toBe(false);
    expect(appNotificationCell.peek()).toEqual({
      message: "This font is open read-only, so strokes cannot be changed.",
    });
  });
});

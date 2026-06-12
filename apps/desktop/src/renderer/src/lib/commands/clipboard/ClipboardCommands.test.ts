import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { CutCommand, PasteCommand } from "./ClipboardCommands";
import type { ClipboardContent } from "../../clipboard/types";

// Restored from the WS6 behavioral inventory (git show ef037c6e^); the old
// CommandHistory plumbing is gone, so commands run through CommandRunner and
// undo through the workspace ledger.
function createTestContent(points: Array<{ x: number; y: number }>): ClipboardContent {
  return {
    contours: [
      {
        points: points.map((p) => ({
          x: p.x,
          y: p.y,
          pointType: "onCurve" as const,
          smooth: false,
        })),
        closed: false,
      },
    ],
  };
}

describe("CutCommand", () => {
  let editor: TestEditor;
  let p1: PointId;
  let p2: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(100, 100);
    await editor.settle();
    editor.clickGlyphLocal(200, 200);
    await editor.settle();
    [p1, p2] = editor.activeGlyphSource!.allPoints.map((point) => point.id) as [PointId, PointId];
  });

  const source = () => editor.activeGlyphSource!;

  it("removes the cut points and keeps the rest", async () => {
    editor.commands.run(new CutCommand([p1]));
    await editor.settle();

    expect(source().allPoints.length).toBe(1);
    expect(source().point(p2)).toMatchObject({ x: 200, y: 200 });
  });

  it("restores the cut points through ledger undo", async () => {
    editor.commands.run(new CutCommand([p1]));
    await editor.settle();
    expect(source().allPoints.length).toBe(1);

    await editor.undoAndSettle();
    expect(source().allPoints.length).toBe(2);
    expect(source().point(p1)).toMatchObject({ x: 100, y: 100 });
  });
});

describe("PasteCommand", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  const source = () => editor.activeGlyphSource!;

  it("creates points offset from the clipboard content", async () => {
    const command = new PasteCommand(createTestContent([{ x: 100, y: 100 }]), {
      offset: { x: 20, y: -20 },
    });

    editor.commands.run(command);
    await editor.settle();

    expect(command.createdPointIds).toHaveLength(1);
    expect(source().point(command.createdPointIds[0]!)).toMatchObject({ x: 120, y: 80 });
  });

  it("creates one contour per clipboard contour", async () => {
    const content: ClipboardContent = {
      contours: [
        { points: [{ x: 0, y: 0, pointType: "onCurve", smooth: false }], closed: false },
        { points: [{ x: 100, y: 100, pointType: "onCurve", smooth: false }], closed: false },
      ],
    };
    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });

    editor.commands.run(command);
    await editor.settle();

    expect(command.createdContourIds).toHaveLength(2);
    expect(source().contours).toHaveLength(2);
  });

  it("removes all pasted geometry with one ledger undo", async () => {
    editor.commands.run(
      new PasteCommand(createTestContent([{ x: 100, y: 100 }]), { offset: { x: 0, y: 0 } }),
    );
    await editor.settle();
    expect(source().allPoints.length).toBe(1);

    await editor.undoAndSettle();
    expect(source().allPoints.length).toBe(0);
    expect(source().contours.length).toBe(0);
  });
});

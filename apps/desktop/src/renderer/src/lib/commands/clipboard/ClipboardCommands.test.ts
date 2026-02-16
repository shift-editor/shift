import { describe, it, expect, beforeEach } from "vitest";
import { CommandHistory } from "../core/CommandHistory";
import { CutCommand, PasteCommand } from "./ClipboardCommands";
import { createMockFontEngine, getAllPoints, getPointCount } from "@/testing";
import type { ClipboardContent } from "../../clipboard/types";
import type { PointId } from "@shift/types";

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
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession({ glyphName: "A", unicode: 65 });
    fontEngine.editing.addContour();
  });

  it("should remove points on execute", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 200,
      y: 200,
      pointType: "onCurve",
      smooth: false,
    });
    expect(getPointCount(fontEngine.$glyph.value)).toBe(2);

    history.execute(new CutCommand([p1]));

    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
    const remaining = getAllPoints(fontEngine.$glyph.value);
    expect(remaining[0].x).toBe(200);
  });

  it("should restore points on undo", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    history.execute(new CutCommand([p1]));
    expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

    history.undo();

    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
    const restored = getAllPoints(fontEngine.$glyph.value);
    expect(restored[0].x).toBe(100);
    expect(restored[0].y).toBe(100);
  });

  it("should remove same points on redo", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    history.execute(new CutCommand([p1]));
    history.undo();
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

    history.redo();

    expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
  });

  it("should handle multiple points", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    const p2 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 200,
      y: 200,
      pointType: "onCurve",
      smooth: false,
    });
    fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 300,
      y: 300,
      pointType: "onCurve",
      smooth: false,
    });

    history.execute(new CutCommand([p1, p2]));

    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
    const remaining = getAllPoints(fontEngine.$glyph.value);
    expect(remaining[0].x).toBe(300);
  });

  it("should have the correct name", () => {
    const cmd = new CutCommand([]);
    expect(cmd.name).toBe("Cut");
  });
});

describe("PasteCommand", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession({ glyphName: "A", unicode: 65 });
    fontEngine.editing.addContour();
  });

  it("should create points on execute", () => {
    const content = createTestContent([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);

    const cmd = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    history.execute(cmd);

    expect(getPointCount(fontEngine.$glyph.value)).toBe(2);
    expect(cmd.createdPointIds.length).toBe(2);
  });

  it("should apply offset to pasted points", () => {
    const content = createTestContent([{ x: 100, y: 100 }]);

    const cmd = new PasteCommand(content, { offset: { x: 20, y: -20 } });
    history.execute(cmd);

    const points = getAllPoints(fontEngine.$glyph.value);
    expect(points[0].x).toBe(120);
    expect(points[0].y).toBe(80);
  });

  it("should remove points on undo", () => {
    const content = createTestContent([{ x: 100, y: 100 }]);
    const cmd = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    history.execute(cmd);
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

    history.undo();

    expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
  });

  it("should restore same state on redo (snapshot-based)", () => {
    const content = createTestContent([{ x: 100, y: 100 }]);
    const cmd = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    history.execute(cmd);
    const originalIds = [...cmd.createdPointIds];

    history.undo();
    history.redo();

    expect(cmd.createdPointIds).toEqual(originalIds);
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
  });

  it("should handle multiple contours", () => {
    const content: ClipboardContent = {
      contours: [
        {
          points: [{ x: 0, y: 0, pointType: "onCurve", smooth: false }],
          closed: false,
        },
        {
          points: [{ x: 100, y: 100, pointType: "onCurve", smooth: false }],
          closed: false,
        },
      ],
    };

    const cmd = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    history.execute(cmd);

    expect(cmd.createdContourIds.length).toBe(2);
  });

  it("should have the correct name", () => {
    const content = createTestContent([]);
    const cmd = new PasteCommand(content, { offset: { x: 0, y: 0 } });
    expect(cmd.name).toBe("Paste");
  });
});

describe("Cut + Paste integration", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession({ glyphName: "A", unicode: 65 });
    fontEngine.editing.addContour();
  });

  it("should support cut then paste workflow", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

    history.execute(new CutCommand([p1]));
    expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

    const content = createTestContent([{ x: 100, y: 100 }]);
    const pasteCmd = new PasteCommand(content, { offset: { x: 20, y: 20 } });
    history.execute(pasteCmd);
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

    const points = getAllPoints(fontEngine.$glyph.value);
    expect(points[0].x).toBe(120);
    expect(points[0].y).toBe(120);
  });

  it("should undo cut and paste separately", () => {
    const p1 = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });

    history.execute(new CutCommand([p1]));

    const content = createTestContent([{ x: 100, y: 100 }]);
    history.execute(new PasteCommand(content, { offset: { x: 0, y: 0 } }));

    expect(history.undoCount.value).toBe(2);

    history.undo();
    expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

    history.undo();
    expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
  });
});

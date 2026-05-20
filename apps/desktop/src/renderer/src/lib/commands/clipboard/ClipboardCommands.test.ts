import { beforeEach, describe, expect, it } from "vitest";
import { CommandHistory } from "../core/CommandHistory";
import { CutCommand, PasteCommand } from "./ClipboardCommands";
import type { ClipboardContent } from "../../clipboard/types";
import type { ContourId } from "@shift/types";
import type { GlyphSource } from "@/lib/model/Glyph";
import { addContour, addPoint, commandSourceFixture, contourPoints, point } from "../testUtils";

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
  let source: GlyphSource;
  let contourId: ContourId;
  let history: CommandHistory;

  beforeEach(() => {
    const fixture = commandSourceFixture();
    source = fixture.source;
    contourId = addContour(source);
    history = new CommandHistory(fixture.$source);
  });

  it("removes points on execute", () => {
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });
    const p2 = addPoint(source, contourId, { x: 200, y: 200 });
    expect(contourPoints(source, contourId).length).toBe(2);

    history.execute(new CutCommand([p1]));

    expect(contourPoints(source, contourId).length).toBe(1);
    expect(point(source, p2).x).toBe(200);
  });

  it("restores points on undo", () => {
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });

    history.execute(new CutCommand([p1]));
    expect(contourPoints(source, contourId).length).toBe(0);

    history.undo();

    expect(contourPoints(source, contourId).length).toBe(1);
    expect(point(source, p1)).toMatchObject({ x: 100, y: 100 });
  });

  it("removes same points on redo", () => {
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });

    history.execute(new CutCommand([p1]));
    history.undo();
    expect(contourPoints(source, contourId).length).toBe(1);

    history.redo();

    expect(contourPoints(source, contourId).length).toBe(0);
  });

  it("handles multiple points", () => {
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });
    const p2 = addPoint(source, contourId, { x: 200, y: 200 });
    const p3 = addPoint(source, contourId, { x: 300, y: 300 });

    history.execute(new CutCommand([p1, p2]));

    expect(contourPoints(source, contourId).length).toBe(1);
    expect(point(source, p3).x).toBe(300);
  });

  it("has the correct name", () => {
    expect(new CutCommand([]).name).toBe("Cut");
  });
});

describe("PasteCommand", () => {
  let source: GlyphSource;
  let history: CommandHistory;

  beforeEach(() => {
    const fixture = commandSourceFixture();
    source = fixture.source;
    addContour(source);
    history = new CommandHistory(fixture.$source);
  });

  it("creates points on execute", () => {
    const start = source.allPoints.length;
    const content = createTestContent([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });

    history.execute(command);

    expect(source.allPoints.length).toBe(start + 2);
    expect(command.createdPointIds.length).toBe(2);
  });

  it("applies offset to pasted points", () => {
    const content = createTestContent([{ x: 100, y: 100 }]);
    const command = new PasteCommand(content, { offset: { x: 20, y: -20 } });

    history.execute(command);

    expect(point(source, command.createdPointIds[0]!)).toMatchObject({ x: 120, y: 80 });
  });

  it("removes points on undo", () => {
    const start = source.allPoints.length;
    const content = createTestContent([{ x: 100, y: 100 }]);
    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });

    history.execute(command);
    expect(source.allPoints.length).toBe(start + 1);

    history.undo();

    expect(source.allPoints.length).toBe(start);
  });

  it("restores same state on redo", () => {
    const start = source.allPoints.length;
    const content = createTestContent([{ x: 100, y: 100 }]);
    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });

    history.execute(command);
    const originalIds = [...command.createdPointIds];
    history.undo();
    history.redo();

    expect(command.createdPointIds).toEqual(originalIds);
    expect(source.allPoints.length).toBe(start + 1);
  });

  it("handles multiple contours", () => {
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
    const command = new PasteCommand(content, { offset: { x: 0, y: 0 } });

    history.execute(command);

    expect(command.createdContourIds.length).toBe(2);
  });

  it("has the correct name", () => {
    const content = createTestContent([]);
    expect(new PasteCommand(content, { offset: { x: 0, y: 0 } }).name).toBe("Paste");
  });
});

describe("Cut + Paste integration", () => {
  let source: GlyphSource;
  let contourId: ContourId;
  let history: CommandHistory;

  beforeEach(() => {
    const fixture = commandSourceFixture();
    source = fixture.source;
    contourId = addContour(source);
    history = new CommandHistory(fixture.$source);
  });

  it("supports cut then paste workflow", () => {
    const start = source.allPoints.length;
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });

    history.execute(new CutCommand([p1]));
    expect(source.allPoints.length).toBe(start);

    const content = createTestContent([{ x: 100, y: 100 }]);
    const pasteCommand = new PasteCommand(content, { offset: { x: 20, y: 20 } });
    history.execute(pasteCommand);

    expect(source.allPoints.length).toBe(start + 1);
    expect(point(source, pasteCommand.createdPointIds[0]!)).toMatchObject({ x: 120, y: 120 });
  });

  it("undoes cut and paste separately", () => {
    const start = source.allPoints.length;
    const p1 = addPoint(source, contourId, { x: 100, y: 100 });

    history.execute(new CutCommand([p1]));
    history.execute(
      new PasteCommand(createTestContent([{ x: 100, y: 100 }]), { offset: { x: 0, y: 0 } }),
    );

    expect(history.undoCount.value).toBe(2);
    history.undo();
    expect(source.allPoints.length).toBe(start);

    history.undo();
    expect(source.allPoints.length).toBe(start + 1);
    expect(point(source, p1)).toMatchObject({ x: 100, y: 100 });
  });
});

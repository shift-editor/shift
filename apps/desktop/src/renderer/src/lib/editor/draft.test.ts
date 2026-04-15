import { describe, expect, it, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { Glyphs } from "@shift/font";
import type { PointId } from "@shift/types";

let editor: TestEditor;

beforeEach(() => {
  editor = new TestEditor();
  editor.startSession();
  editor.bridge.addContour();
});

function addPoint(x: number, y: number): PointId {
  return editor.bridge.addPoint({ x, y, pointType: "onCurve", smooth: false });
}

describe("GlyphDraft", () => {
  it("syncs position updates to Rust on finish", () => {
    const p1 = addPoint(100, 200);
    const p2 = addPoint(300, 400);

    const draft = editor.createDraft();

    draft.setPositions([
      { node: { kind: "point", id: p1 }, x: 150, y: 250 },
      { node: { kind: "point", id: p2 }, x: 350, y: 450 },
    ]);

    draft.finish("Move Points");

    expect(editor.getPointPosition(p1)).toEqual({ x: 150, y: 250 });
    expect(editor.getPointPosition(p2)).toEqual({ x: 350, y: 450 });
  });

  it("restores positions on undo after finish", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.finish("Move Point");

    editor.undo();

    expect(editor.getPointPosition(p1)).toEqual({ x: 100, y: 200 });
  });

  it("restores positions on redo after undo", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.finish("Move Point");

    editor.undo();
    editor.redo();

    expect(editor.getPointPosition(p1)).toEqual({ x: 999, y: 888 });
  });

  it("does not modify Rust on discard", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.discard();

    expect(editor.getPointPosition(p1)).toEqual({ x: 100, y: 200 });
  });

  it("JS model matches Rust after finish", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 50, y: 75 }]);
    draft.finish("Move");

    const jsPosition = editor.getPointPosition(p1);
    const rustPoint = Glyphs.findPoint(editor.bridge.getSnapshot(), p1)!.point;

    expect(jsPosition).toEqual({ x: rustPoint.x, y: rustPoint.y });
    expect(jsPosition).toEqual({ x: 50, y: 75 });
  });
});

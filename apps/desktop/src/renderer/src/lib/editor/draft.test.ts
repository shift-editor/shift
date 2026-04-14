import { describe, expect, it, beforeEach } from "vitest";
import { createBridge } from "@/testing";
import type { NativeBridge } from "@/bridge";
import type { PointId } from "@shift/types";
import { Editor } from "./Editor";

let bridge: NativeBridge;
let editor: Editor;

beforeEach(() => {
  bridge = createBridge();
  editor = new Editor({ bridge });
  bridge.startEditSession("A");
  bridge.addContour();
});

function addPoint(x: number, y: number): PointId {
  return bridge.addPoint({ x, y, pointType: "onCurve", smooth: false });
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

    const snapshot = bridge.getSnapshot();
    const points = snapshot.contours.flatMap((c) => c.points);
    const movedP1 = points.find((p) => p.id === p1)!;
    const movedP2 = points.find((p) => p.id === p2)!;

    expect(movedP1.x).toBe(150);
    expect(movedP1.y).toBe(250);
    expect(movedP2.x).toBe(350);
    expect(movedP2.y).toBe(450);
  });

  it("restores positions on undo after finish", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.finish("Move Point");

    editor.undo();

    const snapshot = bridge.getSnapshot();
    const point = snapshot.contours.flatMap((c) => c.points).find((p) => p.id === p1)!;
    expect(point.x).toBe(100);
    expect(point.y).toBe(200);
  });

  it("restores positions on redo after undo", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.finish("Move Point");

    editor.undo();
    editor.redo();

    const snapshot = bridge.getSnapshot();
    const point = snapshot.contours.flatMap((c) => c.points).find((p) => p.id === p1)!;
    expect(point.x).toBe(999);
    expect(point.y).toBe(888);
  });

  it("does not modify Rust on discard", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 999, y: 888 }]);
    draft.discard();

    const snapshotAfter = bridge.getSnapshot();
    const point = snapshotAfter.contours.flatMap((c) => c.points).find((p) => p.id === p1)!;
    expect(point.x).toBe(100);
    expect(point.y).toBe(200);
  });

  it("JS model matches Rust after finish", () => {
    const p1 = addPoint(100, 200);

    const draft = editor.createDraft();
    draft.setPositions([{ node: { kind: "point", id: p1 }, x: 50, y: 75 }]);
    draft.finish("Move");

    const jsGlyph = bridge.$glyph.peek()!;
    const jsPoint = jsGlyph.contours.flatMap((c) => c.points).find((p) => p.id === p1)!;

    const rustSnapshot = bridge.getSnapshot();
    const rustPoint = rustSnapshot.contours.flatMap((c) => c.points).find((p) => p.id === p1)!;

    expect(jsPoint.x).toBe(rustPoint.x);
    expect(jsPoint.y).toBe(rustPoint.y);
    expect(jsPoint.x).toBe(50);
  });
});

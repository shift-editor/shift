import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { CommandHistory } from "./CommandHistory";
import { AddPointCommand } from "../primitives/PointCommands";
import { NudgePointsCommand } from "../primitives/BezierCommands";
import { addContour, addPoint, commandSourceFixture, contourPoints, point } from "../testUtils";
import type { GlyphSource } from "@/lib/model/Glyph";
import type { ContourId } from "@shift/types";
import type { Signal } from "@/lib/signals/signal";

describe("CommandHistory", () => {
  let source: GlyphSource;
  let $source: Signal<GlyphSource | null>;
  let contourId: ContourId;
  let history: CommandHistory;

  beforeEach(() => {
    const fixture = commandSourceFixture();
    source = fixture.source;
    $source = fixture.$source;
    contourId = addContour(source);
    history = new CommandHistory($source);
  });

  function addPointCommand(x: number, y: number): AddPointCommand {
    return new AddPointCommand(x, y, "onCurve", false, contourId);
  }

  function addSourcePoint(x: number, y: number): PointId {
    return addPoint(source, contourId, { x, y });
  }

  describe("execute", () => {
    it("executes a command and returns the result", () => {
      const pointId = history.execute(addPointCommand(100, 200));

      expect(pointId).toBeDefined();
      expect(contourPoints(source, contourId).length).toBe(1);
    });

    it("adds command to undo stack", () => {
      expect(history.canUndo.value).toBe(false);

      history.execute(addPointCommand(100, 200));

      expect(history.canUndo.value).toBe(true);
      expect(history.undoCount.value).toBe(1);
    });

    it("clears redo stack on new command", () => {
      history.execute(addPointCommand(100, 200));
      history.undo();
      expect(history.canRedo.value).toBe(true);

      history.execute(addPointCommand(150, 250));

      expect(history.canRedo.value).toBe(false);
      expect(history.redoCount.value).toBe(0);
    });
  });

  describe("undo", () => {
    it("undoes the last command", () => {
      history.execute(addPointCommand(100, 200));
      expect(contourPoints(source, contourId).length).toBe(1);

      const didUndo = history.undo();

      expect(didUndo).toBe(true);
      expect(contourPoints(source, contourId).length).toBe(0);
    });

    it("moves command to redo stack", () => {
      history.execute(addPointCommand(100, 200));
      expect(history.canRedo.value).toBe(false);

      history.undo();

      expect(history.canRedo.value).toBe(true);
      expect(history.redoCount.value).toBe(1);
      expect(history.undoCount.value).toBe(0);
    });

    it("returns false when stack is empty", () => {
      expect(history.undo()).toBe(false);
    });

    it("undoes multiple commands in reverse order", () => {
      history.execute(addPointCommand(100, 200));
      history.execute(addPointCommand(150, 250));
      expect(contourPoints(source, contourId).length).toBe(2);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(1);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);
    });
  });

  describe("redo", () => {
    it("redoes the last undone command", () => {
      history.execute(addPointCommand(100, 200));
      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);

      const didRedo = history.redo();

      expect(didRedo).toBe(true);
      expect(contourPoints(source, contourId).length).toBe(1);
    });

    it("moves command back to undo stack", () => {
      history.execute(addPointCommand(100, 200));
      history.undo();

      history.redo();

      expect(history.canUndo.value).toBe(true);
      expect(history.canRedo.value).toBe(false);
    });

    it("returns false when redo stack is empty", () => {
      expect(history.redo()).toBe(false);
    });
  });

  describe("clear", () => {
    it("clears both undo and redo stacks", () => {
      history.execute(addPointCommand(100, 200));
      history.execute(addPointCommand(150, 250));
      history.undo();

      history.clear();

      expect(history.canUndo.value).toBe(false);
      expect(history.canRedo.value).toBe(false);
      expect(history.undoCount.value).toBe(0);
      expect(history.redoCount.value).toBe(0);
    });
  });

  describe("labels", () => {
    it("returns undo label for the last command", () => {
      history.execute(addPointCommand(100, 200));

      expect(history.getUndoLabel()).toBe("Add Point");
    });

    it("returns redo label for the last undone command", () => {
      history.execute(addPointCommand(100, 200));
      history.undo();

      expect(history.getRedoLabel()).toBe("Add Point");
    });

    it("returns null when no commands are available", () => {
      expect(history.getUndoLabel()).toBe(null);
      expect(history.getRedoLabel()).toBe(null);
    });
  });

  describe("batching", () => {
    it("groups multiple commands into a single undo step", () => {
      history.beginBatch("Add Points");
      history.execute(addPointCommand(100, 100));
      history.execute(addPointCommand(200, 200));
      history.execute(addPointCommand(300, 300));
      history.endBatch();

      expect(contourPoints(source, contourId).length).toBe(3);
      expect(history.undoCount.value).toBe(1);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);
    });

    it("tracks batching state", () => {
      expect(history.isBatching).toBe(false);
      history.beginBatch("Test");
      expect(history.isBatching).toBe(true);
      history.endBatch();
      expect(history.isBatching).toBe(false);
    });

    it("throws when beginBatch is called while already batching", () => {
      history.beginBatch("First");
      expect(() => history.beginBatch("Second")).toThrow("Cannot nest batches");
    });

    it("throws when endBatch is called without beginBatch", () => {
      expect(() => history.endBatch()).toThrow("Not in a batch");
    });

    it("does not add empty batch to undo stack", () => {
      history.beginBatch("Empty");
      history.endBatch();
      expect(history.undoCount.value).toBe(0);
    });

    it("handles single command batch same as non-batched", () => {
      history.beginBatch("Single");
      history.execute(addPointCommand(100, 100));
      history.endBatch();

      expect(history.undoCount.value).toBe(1);
      expect(contourPoints(source, contourId).length).toBe(1);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);
    });

    it("uses batch name as undo label", () => {
      history.beginBatch("Draw Curve");
      history.execute(addPointCommand(100, 100));
      history.execute(addPointCommand(200, 200));
      history.endBatch();

      expect(history.getUndoLabel()).toBe("Draw Curve");
    });
  });

  describe("cancelBatch", () => {
    it("discards batch without adding to undo stack", () => {
      history.beginBatch("Cancelled");
      history.execute(addPointCommand(100, 100));
      history.execute(addPointCommand(200, 200));
      history.cancelBatch();

      expect(contourPoints(source, contourId).length).toBe(2);
      expect(history.undoCount.value).toBe(0);
    });

    it("resets batching state", () => {
      history.beginBatch("Test");
      expect(history.isBatching).toBe(true);
      history.cancelBatch();
      expect(history.isBatching).toBe(false);
    });
  });

  describe("withBatch", () => {
    it("returns callback result and groups commands into one undo step", () => {
      const pointId = history.withBatch("Add Points", () => {
        history.execute(addPointCommand(100, 100));
        return history.execute(addPointCommand(200, 200));
      });

      expect(pointId).toBeDefined();
      expect(contourPoints(source, contourId).length).toBe(2);
      expect(history.undoCount.value).toBe(1);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);
    });

    it("cancels batch and rethrows when callback throws", () => {
      expect(() =>
        history.withBatch("Failing Batch", () => {
          history.execute(addPointCommand(100, 100));
          throw new Error("boom");
        }),
      ).toThrow("boom");

      expect(history.isBatching).toBe(false);
      expect(contourPoints(source, contourId).length).toBe(1);
      expect(history.undoCount.value).toBe(0);
    });
  });

  describe("record", () => {
    it("adds command to undo stack without executing", () => {
      const pointId = addSourcePoint(100, 100);
      expect(contourPoints(source, contourId).length).toBe(1);

      source.translate([pointId], { x: 50, y: 50 });
      expect(point(source, pointId).x).toBe(150);

      history.record(new NudgePointsCommand([pointId], 50, 50));
      expect(history.undoCount.value).toBe(1);

      history.undo();
      expect(point(source, pointId).x).toBe(100);
    });

    it("works within a batch", () => {
      const pointId = addSourcePoint(100, 100);

      history.beginBatch("Drag");
      source.translate([pointId], { x: 10, y: 0 });
      source.translate([pointId], { x: 10, y: 0 });
      source.translate([pointId], { x: 10, y: 0 });
      history.record(new NudgePointsCommand([pointId], 30, 0));
      history.endBatch();

      expect(history.undoCount.value).toBe(1);
      expect(point(source, pointId).x).toBe(130);

      history.undo();
      expect(point(source, pointId).x).toBe(100);
    });
  });

  describe("onDirty callback", () => {
    it("calls onDirty when commands execute or record", () => {
      let onDirtyCalled = 0;
      history = new CommandHistory($source, {
        onDirty: () => {
          onDirtyCalled++;
        },
      });

      history.execute(addPointCommand(100, 200));
      history.execute(addPointCommand(150, 250));

      expect(onDirtyCalled).toBe(2);
    });

    it("allows setting onDirty callback after construction", () => {
      let lateDirtyCalled = 0;
      history.setOnDirty(() => {
        lateDirtyCalled++;
      });

      history.execute(addPointCommand(100, 200));
      expect(lateDirtyCalled).toBe(1);
    });

    it("does not throw without onDirty", () => {
      expect(() => history.execute(addPointCommand(100, 200))).not.toThrow();
    });
  });

  describe("command integration", () => {
    it("nudges points and undo returns them to original position", () => {
      const pointId = addSourcePoint(100, 200);

      history.execute(new NudgePointsCommand([pointId], 10, 0));
      expect(point(source, pointId).x).toBe(110);

      history.undo();
      expect(point(source, pointId).x).toBe(100);
    });

    it("handles move undo and redo on existing points", () => {
      const pointId = addSourcePoint(100, 200);

      history.execute(new NudgePointsCommand([pointId], 50, 50));
      expect(point(source, pointId)).toMatchObject({ x: 150, y: 250 });

      history.undo();
      expect(point(source, pointId)).toMatchObject({ x: 100, y: 200 });

      history.redo();
      expect(point(source, pointId)).toMatchObject({ x: 150, y: 250 });
    });

    it("handles add undo and redo", () => {
      history.execute(addPointCommand(100, 200));
      expect(contourPoints(source, contourId).length).toBe(1);

      history.undo();
      expect(contourPoints(source, contourId).length).toBe(0);

      history.redo();
      expect(contourPoints(source, contourId).length).toBe(1);
      expect(contourPoints(source, contourId)[0]).toMatchObject({ x: 100, y: 200 });
    });

    it("handles multiple points with a single command", () => {
      const p1 = addSourcePoint(100, 100);
      const p2 = addSourcePoint(200, 200);

      history.execute(new NudgePointsCommand([p1, p2], 50, 50));
      expect(point(source, p1)).toMatchObject({ x: 150, y: 150 });
      expect(point(source, p2)).toMatchObject({ x: 250, y: 250 });

      history.undo();
      expect(point(source, p1)).toMatchObject({ x: 100, y: 100 });
      expect(point(source, p2)).toMatchObject({ x: 200, y: 200 });
    });
  });
});

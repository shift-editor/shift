/**
 * Tests for CommandHistory integration with commands.
 *
 * These tests verify:
 * - Undo/redo functionality
 * - Command execution through history
 * - Integration with FontEngine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CommandHistory } from "./CommandHistory";
import {
  AddPointCommand,
  MovePointsCommand,
  RemovePointsCommand,
  NudgePointsCommand,
} from "../primitives";
import { createMockFontEngine, getAllPoints, getPointCount } from "@/testing";
import type { PointId } from "@shift/types";

describe("CommandHistory", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  describe("execute", () => {
    it("should execute a command and return the result", () => {
      const cmd = new AddPointCommand(100, 200, "onCurve");
      const pointId = history.execute(cmd);

      expect(pointId).toBeDefined();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
    });

    it("should add command to undo stack", () => {
      expect(history.canUndo.value).toBe(false);

      history.execute(new AddPointCommand(100, 200, "onCurve"));

      expect(history.canUndo.value).toBe(true);
      expect(history.undoCount.value).toBe(1);
    });

    it("should clear redo stack on new command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.undo();
      expect(history.canRedo.value).toBe(true);

      history.execute(new AddPointCommand(150, 250, "onCurve"));

      expect(history.canRedo.value).toBe(false);
      expect(history.redoCount.value).toBe(0);
    });
  });

  describe("undo", () => {
    it("should undo the last command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      const didUndo = history.undo();

      expect(didUndo).toBe(true);
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
    });

    it("should move command to redo stack", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      expect(history.canRedo.value).toBe(false);

      history.undo();

      expect(history.canRedo.value).toBe(true);
      expect(history.redoCount.value).toBe(1);
      expect(history.undoCount.value).toBe(0);
    });

    it("should return false when stack is empty", () => {
      const didUndo = history.undo();
      expect(didUndo).toBe(false);
    });

    it("should undo multiple commands in reverse order", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.execute(new AddPointCommand(150, 250, "onCurve"));
      expect(getPointCount(fontEngine.$glyph.value)).toBe(2);

      history.undo(); // Remove second point
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      history.undo(); // Remove first point
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
    });
  });

  describe("redo", () => {
    it("should redo the last undone command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

      const didRedo = history.redo();

      expect(didRedo).toBe(true);
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
    });

    it("should move command back to undo stack", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.undo();

      history.redo();

      expect(history.canUndo.value).toBe(true);
      expect(history.canRedo.value).toBe(false);
    });

    it("should return false when redo stack is empty", () => {
      const didRedo = history.redo();
      expect(didRedo).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear both undo and redo stacks", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.execute(new AddPointCommand(150, 250, "onCurve"));
      history.undo();

      history.clear();

      expect(history.canUndo.value).toBe(false);
      expect(history.canRedo.value).toBe(false);
      expect(history.undoCount.value).toBe(0);
      expect(history.redoCount.value).toBe(0);
    });
  });

  describe("labels", () => {
    it("should return undo label for the last command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));

      expect(history.getUndoLabel()).toBe("Add Point");
    });

    it("should return redo label for the last undone command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.undo();

      expect(history.getRedoLabel()).toBe("Add Point");
    });

    it("should return null when no commands available", () => {
      expect(history.getUndoLabel()).toBe(null);
      expect(history.getRedoLabel()).toBe(null);
    });
  });
});

describe("batching", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  describe("beginBatch/endBatch", () => {
    it("should group multiple commands into single undo step", () => {
      history.beginBatch("Add Points");
      history.execute(new AddPointCommand(100, 100, "onCurve"));
      history.execute(new AddPointCommand(200, 200, "onCurve"));
      history.execute(new AddPointCommand(300, 300, "onCurve"));
      history.endBatch();

      expect(getPointCount(fontEngine.$glyph.value)).toBe(3);
      expect(history.undoCount.value).toBe(1);

      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
    });

    it("should set isBatching to true during batch", () => {
      expect(history.isBatching).toBe(false);
      history.beginBatch("Test");
      expect(history.isBatching).toBe(true);
      history.endBatch();
      expect(history.isBatching).toBe(false);
    });

    it("should throw if beginBatch called while already batching", () => {
      history.beginBatch("First");
      expect(() => history.beginBatch("Second")).toThrow("Cannot nest batches");
    });

    it("should throw if endBatch called without beginBatch", () => {
      expect(() => history.endBatch()).toThrow("Not in a batch");
    });

    it("should not add empty batch to undo stack", () => {
      history.beginBatch("Empty");
      history.endBatch();
      expect(history.undoCount.value).toBe(0);
    });

    it("should handle single command batch same as non-batched", () => {
      history.beginBatch("Single");
      history.execute(new AddPointCommand(100, 100, "onCurve"));
      history.endBatch();

      expect(history.undoCount.value).toBe(1);
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);
    });

    it("should use batch name as undo label", () => {
      history.beginBatch("Draw Curve");
      history.execute(new AddPointCommand(100, 100, "onCurve"));
      history.execute(new AddPointCommand(200, 200, "onCurve"));
      history.endBatch();

      expect(history.getUndoLabel()).toBe("Draw Curve");
    });
  });

  describe("cancelBatch", () => {
    it("should discard batch without adding to undo stack", () => {
      history.beginBatch("Cancelled");
      history.execute(new AddPointCommand(100, 100, "onCurve"));
      history.execute(new AddPointCommand(200, 200, "onCurve"));
      history.cancelBatch();

      // Points were still added (commands executed)
      expect(getPointCount(fontEngine.$glyph.value)).toBe(2);
      // But no undo entry
      expect(history.undoCount.value).toBe(0);
    });

    it("should reset isBatching state", () => {
      history.beginBatch("Test");
      expect(history.isBatching).toBe(true);
      history.cancelBatch();
      expect(history.isBatching).toBe(false);
    });
  });

  describe("record", () => {
    it("should add command to undo stack without executing", () => {
      // Add point directly (not through history)
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 100,
        pointType: "onCurve",
        smooth: false,
      });
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      // Move point directly
      fontEngine.editing.movePoints([pointId], { x: 50, y: 50 });
      const points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(150);

      // Record the move command (already executed)
      history.record(new MovePointsCommand([pointId], 50, 50));

      expect(history.undoCount.value).toBe(1);

      // Undo should reverse the already-executed move
      history.undo();
      const undonePoints = getAllPoints(fontEngine.$glyph.value);
      expect(undonePoints[0].x).toBe(100);
    });

    it("should work within a batch", () => {
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 100,
        pointType: "onCurve",
        smooth: false,
      });

      history.beginBatch("Drag");
      fontEngine.editing.movePoints([pointId], { x: 10, y: 0 });
      fontEngine.editing.movePoints([pointId], { x: 10, y: 0 });
      fontEngine.editing.movePoints([pointId], { x: 10, y: 0 });
      // Record single command for total movement
      history.record(new MovePointsCommand([pointId], 30, 0));
      history.endBatch();

      expect(history.undoCount.value).toBe(1);
      const points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(130);

      history.undo();
      const undonePoints = getAllPoints(fontEngine.$glyph.value);
      expect(undonePoints[0].x).toBe(100);
    });
  });
});

describe("onDirty callback", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;
  let onDirtyCalled: number;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    onDirtyCalled = 0;
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value, {
      onDirty: () => {
        onDirtyCalled++;
      },
    });
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  it("should call onDirty when command is executed", () => {
    expect(onDirtyCalled).toBe(0);
    history.execute(new AddPointCommand(100, 200, "onCurve"));
    expect(onDirtyCalled).toBe(1);
  });

  it("should call onDirty for each executed command", () => {
    history.execute(new AddPointCommand(100, 200, "onCurve"));
    history.execute(new AddPointCommand(150, 250, "onCurve"));
    expect(onDirtyCalled).toBe(2);
  });

  it("should call onDirty when command is recorded", () => {
    const pointId = fontEngine.editing.addPoint({
      id: "" as PointId,
      x: 100,
      y: 100,
      pointType: "onCurve",
      smooth: false,
    });
    fontEngine.editing.movePoints([pointId], { x: 50, y: 50 });
    expect(onDirtyCalled).toBe(0);

    history.record(new MovePointsCommand([pointId], 50, 50));
    expect(onDirtyCalled).toBe(1);
  });

  it("should call onDirty during batch for each command", () => {
    history.beginBatch("Add Points");
    history.execute(new AddPointCommand(100, 100, "onCurve"));
    expect(onDirtyCalled).toBe(1);
    history.execute(new AddPointCommand(200, 200, "onCurve"));
    expect(onDirtyCalled).toBe(2);
    history.endBatch();
    expect(onDirtyCalled).toBe(2);
  });

  it("should allow setting onDirty callback after construction", () => {
    const historyNoCallback = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    let lateDirtyCalled = 0;
    historyNoCallback.setOnDirty(() => {
      lateDirtyCalled++;
    });

    historyNoCallback.execute(new AddPointCommand(100, 200, "onCurve"));
    expect(lateDirtyCalled).toBe(1);
  });

  it("should not throw if onDirty is not set", () => {
    const historyNoCallback = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    expect(() => {
      historyNoCallback.execute(new AddPointCommand(100, 200, "onCurve"));
    }).not.toThrow();
  });
});

describe("Command integration with history", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.$glyph.value);
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  describe("MovePointsCommand", () => {
    it("should move points and undo returns them to original position", () => {
      // Add a point first
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 200,
        pointType: "onCurve",
        smooth: false,
      });
      const originalPoints = getAllPoints(fontEngine.$glyph.value);
      expect(originalPoints[0].x).toBe(100);
      expect(originalPoints[0].y).toBe(200);

      // Move the point
      history.execute(new MovePointsCommand([pointId], 50, 50));
      const movedPoints = getAllPoints(fontEngine.$glyph.value);
      expect(movedPoints[0].x).toBe(150);
      expect(movedPoints[0].y).toBe(250);

      // Undo the move
      history.undo();
      const restoredPoints = getAllPoints(fontEngine.$glyph.value);
      expect(restoredPoints[0].x).toBe(100);
      expect(restoredPoints[0].y).toBe(200);
    });
  });

  describe("NudgePointsCommand", () => {
    it("should nudge points and undo returns them to original position", () => {
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 200,
        pointType: "onCurve",
        smooth: false,
      });

      history.execute(new NudgePointsCommand([pointId], 10, 0)); // Nudge right
      const nudgedPoints = getAllPoints(fontEngine.$glyph.value);
      expect(nudgedPoints[0].x).toBe(110);

      history.undo();
      const restoredPoints = getAllPoints(fontEngine.$glyph.value);
      expect(restoredPoints[0].x).toBe(100);
    });
  });

  describe("RemovePointsCommand", () => {
    it("should remove points and undo restores them", () => {
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 200,
        pointType: "onCurve",
        smooth: false,
      });
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      history.execute(new RemovePointsCommand([pointId]));
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

      // Note: undo may not restore exact point ID, but restores geometry
      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
      const restoredPoints = getAllPoints(fontEngine.$glyph.value);
      expect(restoredPoints[0].x).toBe(100);
      expect(restoredPoints[0].y).toBe(200);
    });
  });

  describe("Complex undo/redo sequences", () => {
    it("should handle move undo/redo on existing points", () => {
      // Add point directly (not through history)
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 200,
        pointType: "onCurve",
        smooth: false,
      });
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      // Move point through history
      history.execute(new MovePointsCommand([pointId], 50, 50));
      let points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);

      // Undo move
      history.undo();
      points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(200);

      // Redo move
      history.redo();
      points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);
    });

    it("should handle add undo/redo", () => {
      // Add point through history
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);

      // Undo add
      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

      // Redo add (creates new point, potentially with different ID)
      history.redo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
      const points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(200);
    });

    it("should restore point at removed position when undoing remove", () => {
      // Add and move a point
      const pointId = fontEngine.editing.addPoint({
        id: "" as PointId,
        x: 100,
        y: 200,
        pointType: "onCurve",
        smooth: false,
      });
      fontEngine.editing.movePoints([pointId], { x: 50, y: 50 });

      // Now remove via command history
      history.execute(new RemovePointsCommand([pointId]));
      expect(getPointCount(fontEngine.$glyph.value)).toBe(0);

      // Undo remove - restores point at its position when it was removed
      history.undo();
      expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
      const points = getAllPoints(fontEngine.$glyph.value);
      // Note: point is restored at 150,250 (where it was when removed)
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);
    });

    it("should handle multiple points with single command", () => {
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

      // Move both points together
      history.execute(new MovePointsCommand([p1, p2], 50, 50));
      let points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(150);
      expect(points[1].x).toBe(250);
      expect(points[1].y).toBe(250);

      // Undo moves both back
      history.undo();
      points = getAllPoints(fontEngine.$glyph.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(100);
      expect(points[1].x).toBe(200);
      expect(points[1].y).toBe(200);
    });
  });
});

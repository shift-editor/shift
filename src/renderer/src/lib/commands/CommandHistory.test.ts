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
import { AddPointCommand, MovePointsCommand, RemovePointsCommand } from "./PointCommands";
import { NudgePointsCommand } from "./BezierCommands";
import { createMockFontEngine, getAllPoints, getPointCount } from "@/__test-utils__";

describe("CommandHistory", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.snapshot.value);
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  describe("execute", () => {
    it("should execute a command and return the result", () => {
      const cmd = new AddPointCommand(100, 200, "onCurve");
      const pointId = history.execute(cmd);

      expect(pointId).toBeDefined();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
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
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      const didUndo = history.undo();

      expect(didUndo).toBe(true);
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);
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
      expect(getPointCount(fontEngine.snapshot.value)).toBe(2);

      history.undo(); // Remove second point
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      history.undo(); // Remove first point
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);
    });
  });

  describe("redo", () => {
    it("should redo the last undone command", () => {
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      history.undo();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);

      const didRedo = history.redo();

      expect(didRedo).toBe(true);
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
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

describe("Command integration with history", () => {
  let fontEngine: ReturnType<typeof createMockFontEngine>;
  let history: CommandHistory;

  beforeEach(() => {
    fontEngine = createMockFontEngine();
    history = new CommandHistory(fontEngine, () => fontEngine.snapshot.value);
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  });

  describe("MovePointsCommand", () => {
    it("should move points and undo returns them to original position", () => {
      // Add a point first
      const pointId = fontEngine.editing.addPoint(100, 200, "onCurve", false);
      const originalPoints = getAllPoints(fontEngine.snapshot.value);
      expect(originalPoints[0].x).toBe(100);
      expect(originalPoints[0].y).toBe(200);

      // Move the point
      history.execute(new MovePointsCommand([pointId], 50, 50));
      const movedPoints = getAllPoints(fontEngine.snapshot.value);
      expect(movedPoints[0].x).toBe(150);
      expect(movedPoints[0].y).toBe(250);

      // Undo the move
      history.undo();
      const restoredPoints = getAllPoints(fontEngine.snapshot.value);
      expect(restoredPoints[0].x).toBe(100);
      expect(restoredPoints[0].y).toBe(200);
    });
  });

  describe("NudgePointsCommand", () => {
    it("should nudge points and undo returns them to original position", () => {
      const pointId = fontEngine.editing.addPoint(100, 200, "onCurve", false);

      history.execute(new NudgePointsCommand([pointId], 10, 0)); // Nudge right
      const nudgedPoints = getAllPoints(fontEngine.snapshot.value);
      expect(nudgedPoints[0].x).toBe(110);

      history.undo();
      const restoredPoints = getAllPoints(fontEngine.snapshot.value);
      expect(restoredPoints[0].x).toBe(100);
    });
  });

  describe("RemovePointsCommand", () => {
    it("should remove points and undo restores them", () => {
      const pointId = fontEngine.editing.addPoint(100, 200, "onCurve", false);
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      history.execute(new RemovePointsCommand([pointId]));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);

      // Note: undo may not restore exact point ID, but restores geometry
      history.undo();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
      const restoredPoints = getAllPoints(fontEngine.snapshot.value);
      expect(restoredPoints[0].x).toBe(100);
      expect(restoredPoints[0].y).toBe(200);
    });
  });

  describe("Complex undo/redo sequences", () => {
    it("should handle move undo/redo on existing points", () => {
      // Add point directly (not through history)
      const pointId = fontEngine.editing.addPoint(100, 200, "onCurve", false);
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      // Move point through history
      history.execute(new MovePointsCommand([pointId], 50, 50));
      let points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);

      // Undo move
      history.undo();
      points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(200);

      // Redo move
      history.redo();
      points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);
    });

    it("should handle add undo/redo", () => {
      // Add point through history
      history.execute(new AddPointCommand(100, 200, "onCurve"));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      // Undo add
      history.undo();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);

      // Redo add (creates new point, potentially with different ID)
      history.redo();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
      const points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(200);
    });

    it("should restore point at removed position when undoing remove", () => {
      // Add and move a point
      const pointId = fontEngine.editing.addPoint(100, 200, "onCurve", false);
      fontEngine.editing.movePoints([pointId], 50, 50);

      // Now remove via command history
      history.execute(new RemovePointsCommand([pointId]));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(0);

      // Undo remove - restores point at its position when it was removed
      history.undo();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
      const points = getAllPoints(fontEngine.snapshot.value);
      // Note: point is restored at 150,250 (where it was when removed)
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(250);
    });

    it("should handle multiple points with single command", () => {
      const p1 = fontEngine.editing.addPoint(100, 100, "onCurve", false);
      const p2 = fontEngine.editing.addPoint(200, 200, "onCurve", false);

      // Move both points together
      history.execute(new MovePointsCommand([p1, p2], 50, 50));
      let points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(150);
      expect(points[1].x).toBe(250);
      expect(points[1].y).toBe(250);

      // Undo moves both back
      history.undo();
      points = getAllPoints(fontEngine.snapshot.value);
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(100);
      expect(points[1].x).toBe(200);
      expect(points[1].y).toBe(200);
    });
  });
});

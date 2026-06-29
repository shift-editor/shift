import { describe, expect, it, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import {
  MoveSelectionToCommand,
  ReflectPointsCommand,
  RotatePointsCommand,
  ScalePointsCommand,
} from "./TransformCommands";

// Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt on
// the workspace stack: transforms persist through the movePoints intent and
// undo through the workspace ledger.
describe("transform commands through the workspace", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 0);
    await editor.settle();
  });

  const source = () => editor.glyphLayer!;
  const pointIds = () => source().allPoints.map((point) => point.id);
  const positions = () => source().allPoints.map(({ x, y }) => ({ x, y }));

  it("rotates points around an origin", async () => {
    editor.commands.run(new RotatePointsCommand(pointIds(), Math.PI / 2, { x: 0, y: 0 }));
    await editor.settle();

    const [first, second] = positions();
    expect(first!.x).toBeCloseTo(0);
    expect(first!.y).toBeCloseTo(0);
    expect(second!.x).toBeCloseTo(0);
    expect(second!.y).toBeCloseTo(100);
  });

  it("scales points relative to an origin", async () => {
    editor.commands.run(new ScalePointsCommand(pointIds(), 2, 1, { x: 0, y: 0 }));
    await editor.settle();

    expect(positions()).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it("reflects points across a vertical axis through an origin", async () => {
    editor.commands.run(new ReflectPointsCommand(pointIds(), "vertical", { x: 50, y: 0 }));
    await editor.settle();

    expect(positions()).toEqual([
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it("moves the selection so the anchor lands on the target", async () => {
    editor.commands.run(new MoveSelectionToCommand(pointIds(), { x: 10, y: 5 }, { x: 0, y: 0 }));
    await editor.settle();

    expect(positions()).toEqual([
      { x: 10, y: 5 },
      { x: 110, y: 5 },
    ]);
  });

  it("restores all positions with one ledger undo", async () => {
    editor.commands.run(new RotatePointsCommand(pointIds(), Math.PI / 4, { x: 50, y: 50 }));
    await editor.settle();

    await editor.undoAndSettle();
    expect(positions()).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

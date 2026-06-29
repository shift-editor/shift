import { describe, expect, it, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { ToggleSmoothCommand } from "./PointCommands";

// Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt on
// the workspace stack: commands run through CommandRunner, undo through the
// workspace ledger.
describe("ToggleSmoothCommand", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.click(100, 200);
    await editor.settle();
  });

  const source = () => editor.glyphLayer!;

  it("toggles a corner point smooth", async () => {
    const pointId = source().allPoints[0]!.id;

    editor.commands.run(new ToggleSmoothCommand(pointId));
    await editor.settle();

    expect(source().point(pointId)?.smooth).toBe(true);
  });

  it("toggles back through the workspace ledger on undo", async () => {
    const pointId = source().allPoints[0]!.id;

    editor.commands.run(new ToggleSmoothCommand(pointId));
    await editor.settle();
    expect(source().point(pointId)?.smooth).toBe(true);

    await editor.undoAndSettle();
    expect(source().point(pointId)?.smooth).toBe(false);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import {
  SetLeftSidebearingCommand,
  SetRightSidebearingCommand,
  SetXAdvanceCommand,
} from "./SidebearingCommands";

// Restored from the WS6 behavioral inventory (git show ef037c6e^).
describe("sidebearing commands through the workspace", () => {
  let editor: TestEditor;
  let initialAdvance: number;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.clickGlyphLocal(100, 200);
    await editor.settle();
    initialAdvance = editor.activeGlyphSource!.xAdvance;
  });

  const source = () => editor.activeGlyphSource!;

  describe("SetXAdvanceCommand", () => {
    it("sets the advance width", async () => {
      editor.commands.run(new SetXAdvanceCommand(530));
      await editor.settle();

      expect(source().xAdvance).toBe(530);
    });

    it("restores the advance through ledger undo", async () => {
      editor.commands.run(new SetXAdvanceCommand(530));
      await editor.settle();

      await editor.undoAndSettle();
      expect(source().xAdvance).toBe(initialAdvance);
    });
  });

  describe("SetRightSidebearingCommand", () => {
    it("sets the advance width", async () => {
      editor.commands.run(new SetRightSidebearingCommand(530));
      await editor.settle();

      expect(source().xAdvance).toBe(530);
    });
  });

  describe("SetLeftSidebearingCommand", () => {
    it("translates geometry and sets the advance", async () => {
      const pointId = source().allPoints[0]!.id;

      editor.commands.run(new SetLeftSidebearingCommand(520, 20));
      await editor.settle();

      expect(source().xAdvance).toBe(520);
      expect(source().point(pointId)).toMatchObject({ x: 120, y: 200 });
    });

    it("reverts translation and advance with one ledger undo", async () => {
      const pointId = source().allPoints[0]!.id;

      editor.commands.run(new SetLeftSidebearingCommand(520, 20));
      await editor.settle();

      await editor.undoAndSettle();
      expect(source().xAdvance).toBe(initialAdvance);
      expect(source().point(pointId)).toMatchObject({ x: 100, y: 200 });
    });
  });
});

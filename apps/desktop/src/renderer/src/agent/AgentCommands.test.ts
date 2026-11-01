import { beforeEach, describe, expect, it } from "vitest";
import { runRendererCommand } from "@/lib/commands/rendererCommands";
import { useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import type { RendererCommandId } from "@shared/commands";
import { CommandRegistry, type CommandContext } from "../../../main/commands/Command";
import { registerCommands } from "../../../main/commands/Commands";
import { AgentCommands } from "../../../main/agent/AgentCommands";

const WINDOW_ID = 7;

/**
 * Main's command context for one font window, over a test editor: renderer
 * commands reach the editor as the window's renderer runs them, and Save
 * saves its document. Main's other services are out of reach in a test.
 */
function windowContext(editor: EditorTestSurface, state: { hasWorkspace: boolean }) {
  const unavailable = () => {
    throw new Error("not available in this test");
  };
  const context: CommandContext = {
    commandLineTool: { available: () => false, install: unavailable },
    update: { checkForUpdates: unavailable },
    document: {
      create: unavailable,
      open: unavailable,
      openFolder: unavailable,
      canSave: () => state.hasWorkspace,
      hasWorkspace: () => state.hasWorkspace,
      save: async () => {
        await editor.save();
      },
      saveAs: unavailable,
      exportTtf: unavailable,
    },
    windows: {
      active: () => null,
      showAbout: unavailable,
      showFeedback: unavailable,
      showHome: unavailable,
    },
    renderer: {
      available: () => true,
      // Main sends a renderer command and moves on, as `Window.runRendererCommand` does.
      run: (id: RendererCommandId) => {
        if (id === "app.showSettings" || id === "tab.close" || id === "glyph.addComponent") {
          unavailable();
          return;
        }
        void runRendererCommand(editor.asEditor(), id);
      },
    },
  };
  return context;
}

describe("agents run the view commands the window's menu runs, and nothing else", () => {
  const editor = useTestEditor();
  const state = { hasWorkspace: true };
  let agentCommands: AgentCommands;

  beforeEach(() => {
    state.hasWorkspace = true;
    const registry = new CommandRegistry();
    registerCommands(registry);
    const context = windowContext(editor, state);
    // The window's command request goes to main's registry, as `commands.run` does in the app.
    editor.connectAppCommands((command) => registry.run(command, context));
    agentCommands = new AgentCommands(registry, (windowId) => {
      if (windowId !== WINDOW_ID) throw new Error(`Shift window ${windowId} is not open`);
      return {
        context: () => context,
        run: (command, ifFontRevision) =>
          editor.agentControl("commands.run", { command, ifFontRevision }),
      };
    });
    editor.resizeCanvas(800, 600);
  });

  async function fontRevision(): Promise<string> {
    return (await editor.agentControl("editor.select", { ids: editor.editorView().selectionIds }))
      .fontRevision;
  }

  it("lists only the commands that change the view, with their menu labels and shortcuts", () => {
    const listed = agentCommands.list(WINDOW_ID);

    expect(listed.map(({ id }) => id)).toEqual([
      "app.showSettings",
      "tab.close",
      "view.zoomIn",
      "view.zoomOut",
      "ui.increaseSize",
      "ui.decreaseSize",
      "ui.resetSize",
      "edit.selectAll",
      "edit.deselect",
    ]);
    expect(listed).toContainEqual({
      id: "view.zoomIn",
      title: "Zoom In",
      shortcut: "CmdOrCtrl+Plus",
      enabled: true,
    });
    expect(listed).toContainEqual({
      id: "edit.deselect",
      title: "Deselect",
      shortcut: null,
      enabled: true,
    });
  });

  it("zooms the canvas as the menu's Zoom In does, without moving the font revision", async () => {
    const zoom = editor.zoomLevel();
    const before = await fontRevision();

    const ran = await agentCommands.run({
      windowId: WINDOW_ID,
      command: "view.zoomIn",
      ifFontRevision: before,
    });

    expect(ran).toEqual({ ran: true });
    expect(editor.zoomLevel()).toBeCloseTo(zoom * 1.25);
    expect(await fontRevision()).toBe(before);
  });

  it("selects and deselects everything in the open glyph as session state", async () => {
    const { a, b } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y: 100, name: "b" },
          ],
        },
      ],
    });
    await editor.save();

    await agentCommands.run({ windowId: WINDOW_ID, command: "edit.selectAll" });
    expect(editor.selectionIds()).toEqual(expect.arrayContaining([a, b]));

    await agentCommands.run({ windowId: WINDOW_ID, command: "edit.deselect" });
    expect(editor.selectionIds()).toEqual([]);
    expect(await editor.documentState()).toMatchObject({ dirty: false });
  });

  it("refuses Save, Export and Undo, and leaves the document as it was", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
    });
    const outline = await editor.outline();

    for (const command of ["file.save", "file.exportTtf", "edit.undo"]) {
      await expect(
        agentCommands.run({ windowId: WINDOW_ID, command }),
        command,
      ).rejects.toMatchObject({ name: "CommandNotRunnableError", command });
    }

    expect(await editor.documentState()).toMatchObject({ dirty: true });
    expect(await editor.outline()).toEqual(outline);
  });

  it("refuses an unknown command and one its menu item disables", async () => {
    const zoom = editor.zoomLevel();
    await expect(
      agentCommands.run({ windowId: WINDOW_ID, command: "view.zoomSideways" }),
    ).rejects.toMatchObject({ name: "CommandNotFoundError", command: "view.zoomSideways" });

    state.hasWorkspace = false;

    expect(agentCommands.list(WINDOW_ID)).toContainEqual(
      expect.objectContaining({ id: "view.zoomIn", enabled: false }),
    );
    await expect(
      agentCommands.run({ windowId: WINDOW_ID, command: "view.zoomIn" }),
    ).rejects.toMatchObject({ name: "CommandDisabledError", command: "view.zoomIn" });
    expect(editor.zoomLevel()).toBe(zoom);
  });

  it("runs nothing when the font changed since ifFontRevision", async () => {
    const stale = await fontRevision();
    await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
    });
    const zoom = editor.zoomLevel();

    await expect(
      agentCommands.run({ windowId: WINDOW_ID, command: "view.zoomIn", ifFontRevision: stale }),
    ).rejects.toMatchObject({ name: "FontChangedError", expectedRevision: stale });
    expect(editor.zoomLevel()).toBe(zoom);
  });
});

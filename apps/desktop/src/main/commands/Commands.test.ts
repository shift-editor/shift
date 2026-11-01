import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./Command";
import { commands, registerCommands } from "./Commands";

const EFFECTS = ["view", "font", "file", "app"];

function registry(): CommandRegistry {
  const registry = new CommandRegistry();
  registerCommands(registry);
  return registry;
}

describe("every app command declares what running it changes", () => {
  it("gives each command one of the known effects", () => {
    const undeclared = commands.filter((command) => !EFFECTS.includes(command.effect));

    expect(undeclared).toEqual([]);
  });

  it("counts as view only commands that change what the window shows", () => {
    expect(
      registry()
        .withEffect("view")
        .map(({ id }) => id),
    ).toEqual([
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
  });

  it("counts Undo and Redo as font edits, since they replay them", () => {
    const commands = registry();

    expect(commands.find("edit.undo")?.effect).toBe("font");
    expect(commands.find("edit.redo")?.effect).toBe("font");
  });

  it("finds a command by an id from outside the app, and nothing for an unknown one", () => {
    const commands = registry();

    expect(commands.find("file.save")).toMatchObject({ id: "file.save", effect: "file" });
    expect(commands.find("file.delete")).toBeNull();
  });
});

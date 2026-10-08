import { describe, expect, it } from "vitest";
import { commandShortcuts } from "@shared/commands";
import { commandShortcutLabel } from "./commandShortcutLabel";

describe("command shortcuts read the way each platform's menus show them", () => {
  it("uses symbols on macOS", () => {
    expect(commandShortcutLabel(commandShortcuts["file.openFolder"], true)).toBe("⌘⇧O");
  });

  it("spells out modifiers on Windows and Linux", () => {
    expect(commandShortcutLabel(commandShortcuts["file.openFolder"], false)).toBe("Ctrl+Shift+O");
    expect(commandShortcutLabel(commandShortcuts["file.open"], false)).toBe("Ctrl+O");
  });
});

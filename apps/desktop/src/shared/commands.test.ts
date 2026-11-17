import { describe, expect, it } from "vitest";
import {
  commandShortcuts,
  glyphColorCommands,
  glyphColorOf,
  isGlyphColorCommandId,
  toElectronAccelerator,
} from "./commands";

describe("command shortcuts", () => {
  it("provides one shared Add Component chord for native and renderer routing", () => {
    const shortcut = commandShortcuts["glyph.addComponent"];

    expect(shortcut).toEqual({
      key: "c",
      primaryModifier: true,
      controlKey: false,
      shiftKey: true,
      altKey: false,
    });
    expect(toElectronAccelerator(shortcut)).toBe("CmdOrCtrl+Shift+C");
  });

  it("closes a tab with Cmd+W and the window with Shift+Cmd+W", () => {
    expect(toElectronAccelerator(commandShortcuts["tab.close"])).toBe("CmdOrCtrl+W");
    expect(toElectronAccelerator(commandShortcuts["window.close"])).toBe("CmdOrCtrl+Shift+W");
  });

  it("shows the grid with G and toggles snapping to it with Shift+G, both canvas keys", () => {
    expect(commandShortcuts["view.toggleGrid"]).toEqual({
      key: "g",
      primaryModifier: false,
      controlKey: false,
      shiftKey: false,
      altKey: false,
    });
    expect(commandShortcuts["view.toggleSnapToGrid"]).toEqual({
      key: "g",
      primaryModifier: false,
      controlKey: false,
      shiftKey: true,
      altKey: false,
    });
  });

  it("tags with Control and a digit: 1 to 7 for the main colours and 0 for none", () => {
    const accelerators = glyphColorCommands.map(({ id }) =>
      toElectronAccelerator(commandShortcuts[id]),
    );

    expect(accelerators).toEqual([
      "Ctrl+1",
      "Ctrl+2",
      "Ctrl+3",
      "Ctrl+4",
      "Ctrl+5",
      "Ctrl+6",
      "Ctrl+7",
      "Ctrl+0",
    ]);
    expect(glyphColorOf("glyph.color.green")).toBe("darkGreen");
    expect(glyphColorOf("glyph.color.none")).toBeNull();
    expect(isGlyphColorCommandId("glyph.addAnchor")).toBe(false);
  });

  it("converts symbolic and alternate modifiers to Electron syntax", () => {
    expect(toElectronAccelerator(commandShortcuts["view.zoomIn"])).toBe("CmdOrCtrl+Plus");
    expect(toElectronAccelerator(commandShortcuts["ui.increaseSize"])).toBe("CmdOrCtrl+Alt+Plus");
  });
});

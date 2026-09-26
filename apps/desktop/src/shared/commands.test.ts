import { describe, expect, it } from "vitest";
import { commandShortcuts, toElectronAccelerator } from "./commands";

describe("command shortcuts", () => {
  it("provides one shared Add Component chord for native and renderer routing", () => {
    const shortcut = commandShortcuts["glyph.addComponent"];

    expect(shortcut).toEqual({
      key: "c",
      primaryModifier: true,
      shiftKey: true,
      altKey: false,
    });
    expect(toElectronAccelerator(shortcut)).toBe("CmdOrCtrl+Shift+C");
  });

  it("converts symbolic and alternate modifiers to Electron syntax", () => {
    expect(toElectronAccelerator(commandShortcuts["view.zoomIn"])).toBe("CmdOrCtrl+Plus");
    expect(toElectronAccelerator(commandShortcuts["ui.increaseSize"])).toBe("CmdOrCtrl+Alt+Plus");
  });
});

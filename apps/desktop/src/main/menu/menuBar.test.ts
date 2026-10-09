import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { fileMenuItems } from "./menuItems";
import { acceleratorLabel, menuBarFromTemplate, withMenuItemIds } from "./menuBar";

const run = () => {};
const enabled = () => true;
const recents = {
  documents: [
    {
      path: "/fonts/Fraunces.shift",
      documentId: null,
      openedAt: 0,
      location: "~",
      missing: false,
      specimen: null,
    },
  ],
  open: () => {},
  clear: () => {},
};

function windowsTemplate(): MenuItemConstructorOptions[] {
  return withMenuItemIds([
    { label: "File", submenu: [...fileMenuItems(run, enabled, recents, true), { role: "quit" }] },
    { role: "help", submenu: [{ role: "toggleDevTools" }] },
  ]);
}

function allIds(template: readonly MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => [
    item.id ?? "",
    ...(Array.isArray(item.submenu) ? allIds(item.submenu) : []),
  ]);
}

describe("the drawn Windows and Linux menus mirror the native template", () => {
  it("gives every native item a unique id the renderer can activate", () => {
    const ids = allIds(windowsTemplate());

    expect(ids).not.toContain("");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps command ids and shows shortcuts the way Windows and Linux menus do", () => {
    const [file] = menuBarFromTemplate(windowsTemplate(), () => true);

    expect(file).toMatchObject({ kind: "submenu", label: "File", accessKey: "F" });
    if (file?.kind !== "submenu") throw new Error("File is not a submenu");
    expect(file.items).toContainEqual({
      kind: "command",
      id: "file.openFolder",
      label: "Open Font Folder…",
      shortcut: "Ctrl+Shift+O",
      enabled: true,
    });
  });

  it("labels Electron roles and gives them their default shortcuts", () => {
    const bar = menuBarFromTemplate(windowsTemplate(), () => true);
    const file = bar[0]?.kind === "submenu" ? bar[0].items : [];
    const help = bar[1];

    expect(file.at(-1)).toMatchObject({ label: "Quit", shortcut: "Ctrl+Q" });
    expect(help).toMatchObject({ label: "Help", accessKey: "H" });
  });

  it("reports the installed enabled state of each item", () => {
    const bar = menuBarFromTemplate(windowsTemplate(), (id) => id !== "file.save");
    const file = bar[0]?.kind === "submenu" ? bar[0].items : [];

    expect(file.find((item) => item.id === "file.save")).toMatchObject({ enabled: false });
    expect(file.find((item) => item.id === "file.open")).toMatchObject({ enabled: true });
  });
});

describe("accelerators read like Windows and Linux menu shortcuts", () => {
  it("names the primary modifier Ctrl and spells out Plus", () => {
    expect(acceleratorLabel("CmdOrCtrl+Shift+O")).toBe("Ctrl+Shift+O");
    expect(acceleratorLabel("CmdOrCtrl+Plus")).toBe("Ctrl++");
  });
});

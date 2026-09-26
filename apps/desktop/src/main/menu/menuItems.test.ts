import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  commandMenuItem,
  editMenuItems,
  fileMenuItems,
  helpMenuItems,
  viewMenuItems,
} from "./menuItems";

const run = () => {};
const enabled = () => true;
const ids = (items: MenuItemConstructorOptions[]) => items.flatMap(({ id }) => (id ? [id] : []));

describe("application command menu items", () => {
  it("publishes command identity, accelerator, and current capability", () => {
    let invoked: string | null = null;
    const item = commandMenuItem(
      "file.save",
      (id) => {
        invoked = id;
      },
      () => false,
    );

    expect(item).toMatchObject({
      id: "file.save",
      label: "Save",
      accelerator: "CmdOrCtrl+S",
      enabled: false,
    });

    (item.click as () => void)();
    expect(invoked).toBe("file.save");
  });

  it("evaluates every File command through the shared capability callback", () => {
    const checked: string[] = [];
    fileMenuItems(
      () => {},
      (id) => {
        checked.push(id);
        return id === "file.open";
      },
    );

    expect(checked).toEqual([
      "file.new",
      "file.open",
      "file.save",
      "file.saveAs",
      "file.exportTtf",
    ]);
  });

  it("places Settings in Edit only where the platform has no application menu", () => {
    expect(ids(editMenuItems(false, run, enabled))).not.toContain("app.showSettings");
    expect(ids(editMenuItems(true, run, enabled)).at(-1)).toBe("app.showSettings");
    expect(commandMenuItem("app.showSettings", run, enabled).accelerator).toBe("CmdOrCtrl+,");
  });

  it("offers community and support links in Help, with application items when requested", () => {
    const links = [
      "help.openWebsite",
      "help.openDiscord",
      "help.openX",
      "help.reportIssue",
      "help.showLogs",
      "help.emailFeedback",
    ];

    expect(ids(helpMenuItems(false, run, enabled))).toEqual(links);
    expect(ids(helpMenuItems(true, run, enabled))).toEqual([
      ...links,
      "app.checkForUpdates",
      "app.showAbout",
    ]);
  });

  it("separates canvas zoom from interface size in View", () => {
    const items = viewMenuItems(run, enabled);
    const interfaceSize = items.find(({ label }) => label === "Interface Size");

    expect(ids(items)).toEqual(["view.zoomIn", "view.zoomOut"]);
    expect(
      (interfaceSize?.submenu as MenuItemConstructorOptions[]).map(({ label }) => label),
    ).toEqual(["Increase", "Decrease", "Reset"]);
  });
});

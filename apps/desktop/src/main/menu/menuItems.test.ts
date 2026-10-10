import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  commandMenuItem,
  editMenuItems,
  fileMenuItems,
  helpMenuItems,
  openRecentMenuItem,
  viewMenuItems,
} from "./menuItems";
import type { RecentDocument } from "../../shared/recents";

const run = () => {};
const enabled = () => true;
const ids = (items: MenuItemConstructorOptions[]) => items.flatMap(({ id }) => (id ? [id] : []));
const noRecents = { documents: [], open: () => {}, clear: () => {} };

function recent(path: string, missing = false): RecentDocument {
  return { path, documentId: null, openedAt: 0, location: "~", missing, specimen: null };
}

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[];
}

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
      noRecents,
      true,
    );

    expect(checked).toEqual([
      "file.new",
      "file.open",
      "file.openFolder",
      "file.save",
      "file.saveAs",
      "file.exportTtf",
    ]);
  });

  it("offers Open Font Folder only where Open cannot select folders", () => {
    expect(ids(fileMenuItems(run, enabled, noRecents, true))).toContain("file.openFolder");
    expect(ids(fileMenuItems(run, enabled, noRecents, false))).not.toContain("file.openFolder");
  });

  it("opens recent files by path and disables the ones that went missing", () => {
    const opened: string[] = [];
    let cleared = false;
    const items = submenu(
      openRecentMenuItem({
        documents: [recent("/fonts/Fraunces.shift"), recent("/gone/London.otf", true)],
        open: (path) => opened.push(path),
        clear: () => {
          cleared = true;
        },
      }),
    );

    expect(items.map(({ label, enabled }) => ({ label, enabled }))).toEqual([
      { label: "Fraunces.shift", enabled: true },
      { label: "London.otf", enabled: false },
      { label: undefined, enabled: undefined },
      { label: "Clear Menu", enabled: true },
    ]);

    (items[0].click as () => void)();
    (items[3].click as () => void)();
    expect(opened).toEqual(["/fonts/Fraunces.shift"]);
    expect(cleared).toBe(true);
  });

  it("names the parent folder when recent files share a filename", () => {
    const items = submenu(
      openRecentMenuItem({
        documents: [recent("/fonts/Roman/Font.ufo"), recent("/fonts/Italic/Font.ufo")],
        open: () => {},
        clear: () => {},
      }),
    );

    expect(items.slice(0, 2).map(({ label }) => label)).toEqual([
      "Font.ufo — Roman",
      "Font.ufo — Italic",
    ]);
  });

  it("leaves only a disabled Clear Menu when there are no recent files", () => {
    expect(submenu(openRecentMenuItem(noRecents))).toEqual([
      expect.objectContaining({ label: "Clear Menu", enabled: false }),
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
      "app.installCommandLineTool",
      "app.showAbout",
    ]);
  });

  it("separates canvas zoom from interface size in View", () => {
    const items = viewMenuItems(run, enabled);
    const interfaceSize = items.find(({ label }) => label === "Interface Size");
    const sizeItems = (interfaceSize?.submenu ?? []) as MenuItemConstructorOptions[];

    expect(ids(items)).toEqual(["view.zoomIn", "view.zoomOut"]);
    expect(sizeItems.map(({ label }) => label)).toEqual(["Increase", "Decrease", "Reset"]);
  });
});

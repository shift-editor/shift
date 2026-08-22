import { describe, expect, it } from "vitest";
import { commandMenuItem, fileMenuItems } from "./menuItems";

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
});

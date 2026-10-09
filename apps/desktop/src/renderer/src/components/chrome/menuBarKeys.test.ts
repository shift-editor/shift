import { describe, expect, it } from "vitest";
import type { MenuBar } from "@shared/menu/types";
import { menuForAccessKey, splitAccessKey } from "./menuBarKeys";

const bar: MenuBar = [
  { kind: "submenu", id: "menu.0", label: "File", accessKey: "F", enabled: true, items: [] },
  { kind: "submenu", id: "menu.1", label: "Edit", accessKey: "E", enabled: false, items: [] },
];

describe("menu mode opens top-level menus by their access key", () => {
  it("matches the access key regardless of case", () => {
    expect(menuForAccessKey(bar, "f")).toBe("menu.0");
    expect(menuForAccessKey(bar, "F")).toBe("menu.0");
  });

  it("ignores disabled menus, unknown letters, and named keys", () => {
    expect(menuForAccessKey(bar, "e")).toBeNull();
    expect(menuForAccessKey(bar, "x")).toBeNull();
    expect(menuForAccessKey(bar, "Enter")).toBeNull();
  });
});

describe("menu labels underline their access key", () => {
  it("splits around the first matching letter", () => {
    expect(splitAccessKey("Help", "H")).toEqual(["", "H", "elp"]);
  });

  it("leaves labels without an access key whole", () => {
    expect(splitAccessKey("Open Recent", null)).toEqual(["Open Recent", "", ""]);
  });
});

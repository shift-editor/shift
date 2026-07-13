import { describe, expect, it } from "vitest";
import { fileMenuItems } from "./menuItems";

describe("File menu export formats", () => {
  it("groups TrueType export under a format-neutral Export submenu", () => {
    const exportItem = fileMenuItems(() => {}).at(-1);

    expect(exportItem).toMatchObject({
      label: "Export",
      submenu: [{ label: "TrueType (.ttf)…" }],
    });
  });
});

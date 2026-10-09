import { describe, expect, it } from "vitest";
import { openFontDialogOptions, openFontFolderDialogOptions } from "./openFontDialogOptions";

const extensions = (platform: NodeJS.Platform) =>
  openFontDialogOptions(platform).filters?.flatMap((filter) => filter.extensions) ?? [];

describe("the Open dialog selects fonts the platform's picker can choose", () => {
  it.each(["linux", "win32"] as const)("selects font files on %s", (platform) => {
    expect(openFontDialogOptions(platform).properties).toEqual(["openFile"]);
    expect(extensions(platform)).toEqual(expect.arrayContaining(["shift", "ttf", "otf", "glyphs"]));
    expect(extensions(platform)).not.toContain("ufo");
    expect(extensions(platform)).not.toContain("glyphspackage");
  });

  it("selects files and font packages together on macOS", () => {
    expect(openFontDialogOptions("darwin").properties).toEqual(["openFile", "openDirectory"]);
    expect(extensions("darwin")).toEqual(expect.arrayContaining(["ufo", "glyphspackage"]));
  });

  it("selects UFO and Glyphs packages through a folder picker", () => {
    expect(openFontFolderDialogOptions().properties).toEqual(["openDirectory"]);
  });
});

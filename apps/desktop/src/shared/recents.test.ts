import { describe, expect, it } from "vitest";
import { recentFolderLabels, recentOpenedLabel } from "./recents";

describe("recentOpenedLabel", () => {
  const now = new Date(2026, 8, 29, 15, 0).getTime();
  const at = (month: number, day: number, hour = 12, year = 2026) =>
    new Date(year, month, day, hour).getTime();

  it("describes the last week relatively", () => {
    expect(recentOpenedLabel(now - 20_000, now)).toBe("just now");
    expect(recentOpenedLabel(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(recentOpenedLabel(at(8, 29, 14), now)).toBe("1h ago");
    expect(recentOpenedLabel(at(8, 28, 23), now)).toBe("yesterday");
    expect(recentOpenedLabel(at(8, 26), now)).toBe("3 days ago");
  });

  it("switches to a date after a week, adding the year only when it differs", () => {
    expect(recentOpenedLabel(at(8, 12), now)).toBe("12 Sep");
    expect(recentOpenedLabel(at(11, 2, 12, 2025), now)).toBe("2 Dec 2025");
  });
});

describe("recentFolderLabels", () => {
  it("leaves files with a unique name unlabelled", () => {
    expect(recentFolderLabels(["/a/One.ufo", "/b/Two.ufo"]).size).toBe(0);
  });

  it("names the nearest parent folder that tells same-named files apart", () => {
    const labels = recentFolderLabels([
      "/work/Roman/sources/Font.ufo",
      "/work/Italic/sources/Font.ufo",
      "/work/Other.glyphs",
    ]);

    expect(Object.fromEntries(labels)).toEqual({
      "/work/Roman/sources/Font.ufo": "Roman",
      "/work/Italic/sources/Font.ufo": "Italic",
    });
  });

  it("falls back to the parent path when no single folder distinguishes them", () => {
    const labels = recentFolderLabels(["/a/x/Font.ufo", "/a/y/Font.ufo", "/b/x/Font.ufo"]);

    expect(new Set(labels.values()).size).toBe(3);
  });
});

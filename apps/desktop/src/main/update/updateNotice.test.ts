import { describe, expect, it } from "vitest";
import { sameNotice, updateNotice } from "./updateNotice";

describe("the update strip follows the updater", () => {
  it("shows nothing while idle, checking or restarting", () => {
    expect(updateNotice({ type: "idle" }, false)).toEqual({ type: "hidden" });
    expect(updateNotice({ type: "checking", trigger: "automatic" }, false)).toEqual({
      type: "hidden",
    });
    expect(updateNotice({ type: "restarting" }, false)).toEqual({ type: "hidden" });
  });

  it("offers an available update until the user puts it off", () => {
    const status = { type: "available", version: "0.2.0" } as const;

    expect(updateNotice(status, false)).toEqual({ type: "available", version: "0.2.0" });
    expect(updateNotice(status, true)).toEqual({ type: "hidden" });
  });

  it("offers a downloaded update until the user puts it off", () => {
    const status = { type: "ready", version: "0.2.0" } as const;

    expect(updateNotice(status, false)).toEqual({ type: "ready", version: "0.2.0" });
    expect(updateNotice(status, true)).toEqual({ type: "hidden" });
  });

  it("always shows a download in progress", () => {
    const status = { type: "downloading", version: "0.2.0", percent: 67 } as const;

    expect(updateNotice(status, true)).toEqual({
      type: "downloading",
      version: "0.2.0",
      percent: 67,
    });
  });
});

describe("windows hear about a change only when the strip would look different", () => {
  const downloading = (percent: number) =>
    ({ type: "downloading", version: "0.2.0", percent }) as const;

  it("ignores progress within the same whole percent", () => {
    expect(sameNotice(downloading(67.1), downloading(67.9))).toBe(true);
    expect(sameNotice(downloading(67.9), downloading(68))).toBe(false);
  });

  it("tells apart states and versions", () => {
    expect(sameNotice({ type: "hidden" }, { type: "hidden" })).toBe(true);
    expect(sameNotice({ type: "hidden" }, { type: "ready", version: "0.2.0" })).toBe(false);
    expect(
      sameNotice({ type: "available", version: "0.2.0" }, { type: "ready", version: "0.2.0" }),
    ).toBe(false);
    expect(
      sameNotice({ type: "ready", version: "0.2.0" }, { type: "ready", version: "0.2.1" }),
    ).toBe(false);
  });
});

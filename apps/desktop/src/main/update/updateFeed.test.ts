import { describe, expect, it } from "vitest";
import { updateFeed } from "./updateFeed";

const feedBaseUrl = "https://shift-editor.github.io/shift/updates";

describe("native application update feeds", () => {
  it("configures the architecture-specific macOS JSON feed", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "release",
        platform: "darwin",
        architecture: "arm64",
      }),
    ).toEqual({
      url: "https://shift-editor.github.io/shift/updates/release/darwin/arm64/RELEASES.json",
      serverType: "json",
    });
  });

  it("selects the isolated Nightly Windows feed", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "nightly",
        platform: "win32",
        architecture: "x64",
      }),
    ).toEqual({
      url: "https://shift-editor.github.io/shift/updates/nightly/win32/x64",
    });
  });

  it("keeps unsigned Windows Release builds on manual downloads", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "release",
        platform: "win32",
        architecture: "x64",
      }),
    ).toBeNull();
  });

  it("keeps Linux on manual downloads", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "nightly",
        platform: "linux",
        architecture: "x64",
      }),
    ).toBeNull();
  });

  it("requires HTTPS", () => {
    expect(() =>
      updateFeed("http://example.com/updates", {
        distribution: "release",
        platform: "darwin",
        architecture: "x64",
      }),
    ).toThrow("Update feed must use HTTPS");
  });
});

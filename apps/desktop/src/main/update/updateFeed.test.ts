import { describe, expect, it } from "vitest";
import { loadUpdate } from "./updateFeed";

const feedBaseUrl = "https://shift-editor.github.io/shift/updates";

describe("native application update feeds", () => {
  it("selects the exact Release macOS feed", () => {
    expect(
      loadUpdate(feedBaseUrl, {
        distribution: "release",
        platform: "darwin",
        architecture: "arm64",
      }),
    ).toBe("https://shift-editor.github.io/shift/updates/release/darwin/arm64/RELEASES.json");
  });

  it("selects the isolated Nightly Windows feed", () => {
    expect(
      loadUpdate(feedBaseUrl, {
        distribution: "nightly",
        platform: "win32",
        architecture: "x64",
      }),
    ).toBe("https://shift-editor.github.io/shift/updates/nightly/win32/x64");
  });

  it("rejects unsupported Windows architectures", () => {
    expect(() =>
      loadUpdate(feedBaseUrl, {
        distribution: "release",
        platform: "win32",
        architecture: "arm64",
      }),
    ).toThrow("Unsupported Windows update architecture");
  });

  it("requires HTTPS", () => {
    expect(() =>
      loadUpdate("http://example.com/updates", {
        distribution: "release",
        platform: "darwin",
        architecture: "x64",
      }),
    ).toThrow("Update feed must use HTTPS");
  });
});

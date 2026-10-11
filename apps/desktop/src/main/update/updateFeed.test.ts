import { describe, expect, it } from "vitest";
import { updateFeed } from "./updateFeed";

const feedBaseUrl = "https://feeds.shift.graphics/updates";

describe("electron-updater channels", () => {
  it("selects the architecture-specific macOS Release channel", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "release",
        platform: "darwin",
        architecture: "arm64",
        linuxInstallation: null,
      }),
    ).toEqual({
      provider: "generic",
      url: "https://feeds.shift.graphics/updates/release/darwin/arm64",
    });
  });

  it.each(["arm64", "x64"] as const)(
    "selects the isolated Windows Nightly %s channel",
    (architecture) => {
      expect(
        updateFeed(feedBaseUrl, {
          distribution: "nightly",
          platform: "win32",
          architecture,
          linuxInstallation: null,
        }),
      ).toEqual({
        provider: "generic",
        url: `https://feeds.shift.graphics/updates/nightly/win32/${architecture}`,
      });
    },
  );

  it("keeps unsigned Windows Release builds on manual downloads", () => {
    expect(
      updateFeed(feedBaseUrl, {
        distribution: "release",
        platform: "win32",
        architecture: "x64",
        linuxInstallation: null,
      }),
    ).toBeNull();
  });

  it.each(["arm64", "x64"] as const)(
    "selects the Linux %s channel for an AppImage Shift can replace",
    (architecture) => {
      expect(
        updateFeed(feedBaseUrl, {
          distribution: "nightly",
          platform: "linux",
          architecture,
          linuxInstallation: "appImage",
        }),
      ).toEqual({
        provider: "generic",
        url: `https://feeds.shift.graphics/updates/nightly/linux/${architecture}`,
      });
    },
  );

  it.each(["systemPackage", "readOnlyAppImage", null] as const)(
    "keeps a Linux %s install off the in-app updater",
    (linuxInstallation) => {
      expect(
        updateFeed(feedBaseUrl, {
          distribution: "release",
          platform: "linux",
          architecture: "x64",
          linuxInstallation,
        }),
      ).toBeNull();
    },
  );

  it("requires HTTPS", () => {
    expect(() =>
      updateFeed("http://example.com/updates", {
        distribution: "release",
        platform: "darwin",
        architecture: "x64",
        linuxInstallation: null,
      }),
    ).toThrow("Update feed must use HTTPS");
  });
});

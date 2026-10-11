import path from "node:path";
import { describe, expect, it } from "vitest";
import { configDirectory, type ConfigDirectoryInput } from "./configDirectory";

const linux: ConfigDirectoryInput = {
  platform: "linux",
  buildName: "shift-nightly",
  homeDirectory: "/home/ada",
  userDataDirectory: "/home/ada/.config/Shift Nightly",
  explicitUserDataDirectory: false,
  xdgConfigHome: undefined,
};

describe("configDirectory", () => {
  it("uses ~/.config/<build> on Linux and macOS", () => {
    expect(configDirectory(linux)).toBe("/home/ada/.config/shift-nightly");
    expect(configDirectory({ ...linux, platform: "darwin" })).toBe(
      "/home/ada/.config/shift-nightly",
    );
  });

  it("follows an absolute XDG_CONFIG_HOME and ignores a relative one", () => {
    expect(configDirectory({ ...linux, xdgConfigHome: "/dotfiles/config" })).toBe(
      "/dotfiles/config/shift-nightly",
    );
    expect(configDirectory({ ...linux, xdgConfigHome: "config" })).toBe(
      "/home/ada/.config/shift-nightly",
    );
  });

  it("keeps the config in user data on Windows", () => {
    const userData = path.join("C:", "Users", "ada", "AppData", "Roaming", "Shift Nightly");

    expect(configDirectory({ ...linux, platform: "win32", userDataDirectory: userData })).toBe(
      path.join(userData, "config"),
    );
  });

  it("keeps the config inside an explicit --user-data-dir", () => {
    expect(
      configDirectory({
        ...linux,
        userDataDirectory: "/tmp/e2e/user-data",
        explicitUserDataDirectory: true,
      }),
    ).toBe("/tmp/e2e/user-data/config");
  });
});

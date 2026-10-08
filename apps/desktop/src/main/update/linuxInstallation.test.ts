import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectLinuxInstallation } from "./linuxInstallation";

describe("Linux builds are classified by who may replace them", () => {
  let root: string;
  let resources: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "shift-linux-installation-"));
    resources = path.join(root, "resources");
    await mkdir(resources);
  });

  afterEach(async () => {
    await chmod(root, 0o755);
    await rm(root, { recursive: true, force: true });
  });

  it("treats an AppImage in a writable folder as replaceable", () => {
    expect(detectLinuxInstallation(path.join(root, "Shift.AppImage"), resources)).toBe("appImage");
  });

  it.skipIf(process.getuid?.() === 0)(
    "treats an AppImage in a read-only folder as fixed",
    async () => {
      await chmod(root, 0o555);

      expect(detectLinuxInstallation(path.join(root, "Shift.AppImage"), resources)).toBe(
        "readOnlyAppImage",
      );
    },
  );

  it("recognises a DEB or RPM install by its package marker", async () => {
    await writeFile(path.join(resources, "package-type"), "deb");

    expect(detectLinuxInstallation(undefined, resources)).toBe("systemPackage");
  });

  it("ignores a relative APPIMAGE path", async () => {
    await writeFile(path.join(resources, "package-type"), "rpm");

    expect(detectLinuxInstallation("Shift.AppImage", resources)).toBe("systemPackage");
  });

  it("leaves unrecognised builds unclassified", () => {
    expect(detectLinuxInstallation(undefined, resources)).toBeNull();
  });
});

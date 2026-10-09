import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendPath, CommandLineTool, commandName } from "./CommandLineTool";

const log = { debug() {}, info() {}, warn() {}, error() {} };
let root: string;
let bundled: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "shift-cli-install-"));
  bundled = path.join(root, "app", "bin", commandName());
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, "#!/bin/sh\necho shift 1\n", { mode: 0o755 });
});

afterEach(() => {
  fs.chmodSync(root, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("CommandLineTool", () => {
  it("is unavailable when the build has no bundled binary", async () => {
    const tool = new CommandLineTool({
      bundledPath: path.join(root, "missing", commandName()),
      install: { kind: "link", directory: path.join(root, "bin") },
      log,
    });

    expect(await tool.state()).toEqual({ status: "unavailable", commandPath: null, note: null });
    await expect(tool.install()).rejects.toThrow("not bundled");
  });

  it.skipIf(process.platform === "win32")(
    "links the bundled binary and replaces a different shift-cli",
    async () => {
      const directory = path.join(root, "usr-local-bin");
      const target = path.join(directory, commandName());
      const tool = new CommandLineTool({
        bundledPath: bundled,
        install: { kind: "link", directory },
        log,
      });

      expect((await tool.state()).status).toBe("notInstalled");
      expect(await tool.install()).toMatchObject({ status: "installed", commandPath: target });
      expect(fs.realpathSync(target)).toBe(fs.realpathSync(bundled));

      fs.rmSync(target);
      fs.writeFileSync(target, "someone else's shift-cli");
      expect((await tool.state()).status).toBe("conflict");
      expect((await tool.install()).status).toBe("installed");
    },
  );

  it.skipIf(process.platform === "win32")(
    "notes when the terminal runs a different shift-cli earlier on PATH",
    async () => {
      const directory = path.join(root, "usr-local-bin");
      const cargo = path.join(root, "cargo-bin", commandName());
      let resolved = path.join(directory, commandName());
      const tool = new CommandLineTool({
        bundledPath: bundled,
        install: { kind: "link", directory },
        resolveCommand: async () => resolved,
        log,
      });

      expect(await tool.install()).toMatchObject({ status: "installed", note: null });

      resolved = cargo;
      const shadowed = await tool.state();
      expect(shadowed.status).toBe("installed");
      expect(shadowed.note).toContain(cargo);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "asks for elevation when the link directory is protected",
    async () => {
      const directory = path.join(root, "protected");
      fs.mkdirSync(directory);
      fs.chmodSync(directory, 0o555);
      const elevated: string[][] = [];
      const tool = new CommandLineTool({
        bundledPath: bundled,
        install: { kind: "link", directory },
        // Stands in for the admin prompt: it performs the same privileged step.
        elevate: async (dir, source, target) => {
          elevated.push([dir, source, target]);
          fs.chmodSync(dir, 0o755);
          fs.symlinkSync(source, target);
        },
        log,
      });

      expect((await tool.install()).status).toBe("installed");
      expect(elevated).toEqual([[directory, bundled, path.join(directory, commandName())]]);
    },
  );

  it("copies the binary for AppImages and refreshes it after an update", async () => {
    const directory = path.join(root, "home", ".local", "bin");
    const target = path.join(directory, commandName());
    const tool = new CommandLineTool({
      bundledPath: bundled,
      install: { kind: "copy", directory },
      log,
    });

    expect((await tool.install()).status).toBe("installed");
    expect(fs.readFileSync(target, "utf8")).toBe(fs.readFileSync(bundled, "utf8"));
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);

    fs.writeFileSync(bundled, "#!/bin/sh\necho shift 2\n");
    expect((await tool.state()).status).toBe("outdated");
    await tool.refresh();
    expect((await tool.state()).status).toBe("installed");
    expect(fs.readFileSync(target, "utf8")).toContain("shift 2");
  });

  it("adds the bundled directory to the Windows user PATH once", async () => {
    let userPath = String.raw`C:\Tools;C:\Other`;
    const tool = new CommandLineTool({
      bundledPath: bundled,
      install: { kind: "userPath" },
      userPath: {
        read: async () => userPath,
        write: async (value) => {
          userPath = value;
        },
      },
      log,
    });

    expect((await tool.state()).status).toBe("notInstalled");
    expect((await tool.install()).status).toBe("installed");
    await tool.install();

    expect(userPath.split(";")).toEqual([
      String.raw`C:\Tools`,
      String.raw`C:\Other`,
      path.dirname(bundled),
    ]);
  });
});

describe("appendPath", () => {
  it("appends a missing directory and keeps an existing one", () => {
    expect(appendPath("", "/opt/shift/bin")).toBe("/opt/shift/bin");
    expect(appendPath("/a;/b", "/c")).toBe("/a;/b;/c");
    expect(appendPath("/a;/c/", "/c")).toBe("/a;/c/");
  });
});

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ShiftLogger } from "../logging";

const run = promisify(execFile);

/** Whether the `shift-cli` bundled with the app is on the user's PATH. */
export interface CommandLineToolState {
  /**
   * `unavailable` when this build has no bundled binary; `conflict` when a different
   * `shift-cli` is at the install location; `outdated` when an installed copy is older.
   */
  status: "unavailable" | "notInstalled" | "installed" | "outdated" | "conflict";
  /** Where the installed command lives, or the bundled binary on Windows. */
  commandPath: string | null;
  /** A follow-up step for the user, such as adding a directory to PATH. */
  note: string | null;
}

/** How the bundled `shift-cli` reaches the user's PATH on this platform. */
export type CommandLineToolInstall =
  /** A symlink in a PATH directory, created with admin rights when needed (macOS, Linux packages). */
  | { kind: "link"; directory: string }
  /** A copy in a user PATH directory, refreshed each launch (Linux AppImage, whose path changes). */
  | { kind: "copy"; directory: string }
  /** The bundled `bin` directory appended to the user PATH (Windows). */
  | { kind: "userPath" };

export interface CommandLineToolOptions {
  /** The `shift-cli` binary shipped with this build, or `null` when it is not bundled. */
  bundledPath: string | null;
  install: CommandLineToolInstall;
  /** Runs a privileged shell step after a permission error (macOS admin prompt, Linux pkexec). */
  elevate?: (directory: string, source: string, target: string) => Promise<void>;
  /** Reads and writes the Windows user PATH. */
  userPath?: { read(): Promise<string>; write(value: string): Promise<void> };
  log: ShiftLogger;
}

/**
 * Puts the `shift-cli` bundled with the app on the user's PATH.
 *
 * @remarks
 * The installed command always runs the app's own binary (a link or the PATH
 * entry) or a copy refreshed on launch, so its version matches the app, the
 * MCP server, and the bundled skill. A different `shift-cli` already at the
 * target is reported as a conflict and replaced only when the user installs.
 */
export class CommandLineTool {
  readonly #bundledPath: string | null;
  readonly #install: CommandLineToolInstall;
  readonly #elevate: CommandLineToolOptions["elevate"];
  readonly #userPath: CommandLineToolOptions["userPath"];
  readonly #log: ShiftLogger;

  constructor(options: CommandLineToolOptions) {
    this.#bundledPath = options.bundledPath;
    this.#install = options.install;
    this.#elevate = options.elevate;
    this.#userPath = options.userPath;
    this.#log = options.log;
  }

  /** Whether this build bundles a binary to install. */
  get available(): boolean {
    return this.#bundledPath !== null && fs.existsSync(this.#bundledPath);
  }

  async state(): Promise<CommandLineToolState> {
    const bundled = this.#bundledPath;
    if (!bundled || !fs.existsSync(bundled)) {
      return { status: "unavailable", commandPath: null, note: null };
    }

    switch (this.#install.kind) {
      case "link":
      case "copy": {
        const target = path.join(this.#install.directory, commandName());
        return {
          status: await this.#fileStatus(target, bundled),
          commandPath: target,
          note: this.#install.kind === "copy" ? pathNote(this.#install.directory) : null,
        };
      }
      case "userPath": {
        const directory = path.dirname(bundled);
        const entries = splitPath(await this.#requireUserPath().read());
        return {
          status: entries.some((entry) => samePath(entry, directory))
            ? "installed"
            : "notInstalled",
          commandPath: bundled,
          note: "Open a new terminal window to use shift-cli.",
        };
      }
    }
  }

  /** Installs or repairs the command; resolves with the resulting state. */
  async install(): Promise<CommandLineToolState> {
    const bundled = this.#bundledPath;
    if (!bundled || !fs.existsSync(bundled))
      throw new Error("shift-cli is not bundled with this build");

    switch (this.#install.kind) {
      case "link":
        await this.#link(this.#install.directory, bundled);
        break;
      case "copy":
        copyInto(this.#install.directory, bundled);
        break;
      case "userPath": {
        const userPath = this.#requireUserPath();
        await userPath.write(appendPath(await userPath.read(), path.dirname(bundled)));
        break;
      }
    }
    this.#log.info("installed shift-cli", { install: this.#install.kind });
    return this.state();
  }

  /** Keeps an installed copy in step with the app after an update (AppImage). */
  async refresh(): Promise<void> {
    const bundled = this.#bundledPath;
    if (this.#install.kind !== "copy" || !bundled || !fs.existsSync(bundled)) return;

    const target = path.join(this.#install.directory, commandName());
    if ((await this.#fileStatus(target, bundled)) === "outdated") {
      copyInto(this.#install.directory, bundled);
      this.#log.info("refreshed shift-cli copy", { target });
    }
  }

  async #link(directory: string, source: string): Promise<void> {
    const target = path.join(directory, commandName());
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.rmSync(target, { force: true });
      fs.symlinkSync(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!this.#elevate || (code !== "EACCES" && code !== "EPERM")) throw error;
      await this.#elevate(directory, source, target);
    }
  }

  async #fileStatus(target: string, bundled: string): Promise<CommandLineToolState["status"]> {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch {
      return "notInstalled";
    }

    if (this.#install.kind === "link") {
      if (!stat.isSymbolicLink()) return "conflict";
      const linked = path.resolve(path.dirname(target), fs.readlinkSync(target));
      return samePath(linked, bundled) ? "installed" : "conflict";
    }
    if (!stat.isFile()) return "conflict";
    return sameContents(target, bundled) ? "installed" : "outdated";
  }

  #requireUserPath(): NonNullable<CommandLineToolOptions["userPath"]> {
    if (!this.#userPath) throw new Error("No user PATH access configured");
    return this.#userPath;
  }
}

/** Appends `directory` to a `;`-separated Windows PATH unless it is already present. */
export function appendPath(current: string, directory: string): string {
  const entries = splitPath(current);
  if (entries.some((entry) => samePath(entry, directory))) return current;
  return [...entries, directory].join(";");
}

/** The executable name for this platform. */
export function commandName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "shift-cli.exe" : "shift-cli";
}

/** macOS admin prompt for creating the link in a protected directory. */
export async function elevateWithOsascript(directory: string, source: string, target: string) {
  const command = `mkdir -p ${shellQuote(directory)} && ln -sf ${shellQuote(source)} ${shellQuote(target)}`;
  const script = `do shell script "${appleScriptString(command)}" with administrator privileges with prompt "Shift wants to install the shift-cli command."`;
  await run("osascript", ["-e", script]);
}

/** Linux polkit prompt for creating the link in a protected directory. */
export async function elevateWithPkexec(directory: string, source: string, target: string) {
  await run("pkexec", [
    "sh",
    "-c",
    'mkdir -p "$1" && ln -sf "$2" "$3"',
    "sh",
    directory,
    source,
    target,
  ]);
}

/** Reads and writes the Windows user PATH through PowerShell, which broadcasts the change. */
export const windowsUserPath = {
  async read(): Promise<string> {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    return stdout.trim();
  },
  async write(value: string): Promise<void> {
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::SetEnvironmentVariable('Path', $env:SHIFT_USER_PATH, 'User')",
      ],
      { env: { ...process.env, SHIFT_USER_PATH: value } },
    );
  },
};

function splitPath(value: string): string[] {
  return value.split(";").filter((entry) => entry.length > 0);
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32"
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : normalize(a) === normalize(b);
}

function sameContents(a: string, b: string): boolean {
  const left = fs.statSync(a);
  const right = fs.statSync(b);
  return left.size === right.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function copyInto(directory: string, source: string): void {
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, commandName());
  const temporary = `${target}.${process.pid}.tmp`;
  fs.copyFileSync(source, temporary);
  fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, target);
}

function pathNote(directory: string): string | null {
  const entries = (process.env.PATH ?? "").split(path.delimiter);
  return entries.some((entry) => samePath(entry, directory))
    ? null
    : `Add ${directory} to your PATH to use shift-cli.`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function appleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

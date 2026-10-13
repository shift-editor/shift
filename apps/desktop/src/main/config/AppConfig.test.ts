import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigState } from "../../shared/config/config";
import type { ShiftLogger } from "../logging";
import { AppConfig } from "./AppConfig";

const log: ShiftLogger = { debug() {}, info() {}, warn() {}, error() {} };
let directory: string;
let config: AppConfig | null = null;

function open(): AppConfig {
  config = new AppConfig({ directory, log });
  return config;
}

function write(source: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "config.toml"), source);
}

function read(): string {
  return fs.readFileSync(path.join(directory, "config.toml"), "utf8");
}

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shift-config-")), "shift");
});

afterEach(() => {
  config?.close();
  config = null;
  fs.rmSync(path.dirname(directory), { recursive: true, force: true });
});

describe("AppConfig", () => {
  it("chooses no theme and creates no file when config.toml is missing", () => {
    expect(open().state).toEqual({ directory, exists: false, theme: null, problems: [] });
    expect(fs.existsSync(path.join(directory, "config.toml"))).toBe(false);
  });

  it("reads the theme from config.toml", () => {
    write(`theme = "nord"\n`);

    expect(open().state).toMatchObject({ exists: true, theme: "nord", problems: [] });
  });

  it("creates config.toml on the first change", () => {
    const state = open().setTheme("dracula");

    expect(read()).toBe(`theme = "dracula"\n`);
    expect(state).toMatchObject({ exists: true, theme: "dracula" });
  });

  it("writes and reads a mode with a theme for each appearance", () => {
    write(`# rice\ntheme = "nord" # cold\n`);

    const state = open().setTheme({ mode: "system", light: "gruvbox-light", dark: "nord" });

    expect(read()).toBe(
      `# rice\ntheme = { mode = "system", light = "gruvbox-light", dark = "nord" } # cold\n`,
    );
    expect(state.theme).toEqual({ mode: "system", light: "gruvbox-light", dark: "nord" });
  });

  it("keeps the last valid theme and reports the error when the file breaks", () => {
    write(`theme = "nord"\n`);
    const appConfig = open();

    write(`theme = "dracula\n`);
    appConfig.reload();

    expect(appConfig.state.theme).toBe("nord");
    expect(appConfig.state.problems).toEqual([
      expect.objectContaining({ severity: "error", line: 1 }),
    ]);
  });

  it("refuses to write over a file with errors", () => {
    write(`theme = "dracula\n`);
    const appConfig = open();

    expect(() => appConfig.setTheme("nord")).toThrow(/has errors/);
    expect(read()).toBe(`theme = "dracula\n`);
  });

  it("applies an edit made by another program", async () => {
    write(`theme = "nord"\n`);
    const appConfig = open();
    const changes: AppConfigState[] = [];
    appConfig.onChanged((state) => changes.push(state));
    await appConfig.watch();

    // Write through a rename, as most editors do.
    fs.writeFileSync(path.join(directory, "config.toml.tmp"), `theme = "gruvbox-dark"\n`);
    fs.renameSync(path.join(directory, "config.toml.tmp"), path.join(directory, "config.toml"));

    await vi.waitFor(() => expect(appConfig.state.theme).toBe("gruvbox-dark"), { timeout: 2000 });
    expect(changes.at(-1)?.theme).toBe("gruvbox-dark");
  });

  it("writes through a symlinked config.toml to its target", () => {
    const dotfile = path.join(path.dirname(directory), "dotfiles", "config.toml");
    fs.mkdirSync(path.dirname(dotfile), { recursive: true });
    fs.writeFileSync(dotfile, `# mine\ntheme = "nord"\n`);
    fs.mkdirSync(directory, { recursive: true });
    fs.symlinkSync(dotfile, path.join(directory, "config.toml"));

    open().setTheme("dracula");

    expect(fs.lstatSync(path.join(directory, "config.toml")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(dotfile, "utf8")).toBe(`# mine\ntheme = "dracula"\n`);
    expect(fs.readdirSync(path.dirname(dotfile))).toEqual(["config.toml"]);
  });

  it("applies an edit made to the target of a symlinked config.toml", async () => {
    const dotfile = path.join(path.dirname(directory), "dotfiles", "config.toml");
    fs.mkdirSync(path.dirname(dotfile), { recursive: true });
    fs.writeFileSync(dotfile, `theme = "nord"\n`);
    fs.mkdirSync(directory, { recursive: true });
    fs.symlinkSync(dotfile, path.join(directory, "config.toml"));
    const appConfig = open();
    await appConfig.watch();

    fs.writeFileSync(`${dotfile}.tmp`, `theme = "gruvbox-dark"\n`);
    fs.renameSync(`${dotfile}.tmp`, dotfile);

    await vi.waitFor(() => expect(appConfig.state.theme).toBe("gruvbox-dark"), { timeout: 2000 });
  });

  it("follows a config.toml symlinked after watching starts", async () => {
    write(`theme = "nord"\n`);
    const appConfig = open();
    await appConfig.watch();
    const dotfile = path.join(path.dirname(directory), "dotfiles", "config.toml");
    fs.mkdirSync(path.dirname(dotfile), { recursive: true });
    fs.writeFileSync(dotfile, `theme = "dracula"\n`);

    fs.rmSync(path.join(directory, "config.toml"));
    fs.symlinkSync(dotfile, path.join(directory, "config.toml"));
    await vi.waitFor(() => expect(appConfig.state.theme).toBe("dracula"), { timeout: 2000 });

    fs.writeFileSync(`${dotfile}.tmp`, `theme = "gruvbox-dark"\n`);
    fs.renameSync(`${dotfile}.tmp`, dotfile);

    await vi.waitFor(() => expect(appConfig.state.theme).toBe("gruvbox-dark"), { timeout: 2000 });
  });

  it("publishes nothing when a reload finds the same settings", () => {
    write(`theme = "nord"\n`);
    const appConfig = open();
    const published: AppConfigState[] = [];
    appConfig.onChanged((state) => published.push(state));

    write(`theme = "nord" # unchanged\n`);
    appConfig.reload();

    expect(published).toEqual([]);
  });
});

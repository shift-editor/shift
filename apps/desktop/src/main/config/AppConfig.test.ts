import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfigState } from "../../shared/config/config";
import { AppConfig } from "./AppConfig";

const log = { warn() {} };
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
    appConfig.watch();

    // Write through a rename, as most editors do.
    fs.writeFileSync(path.join(directory, "config.toml.tmp"), `theme = "gruvbox-dark"\n`);
    fs.renameSync(path.join(directory, "config.toml.tmp"), path.join(directory, "config.toml"));

    await vi.waitFor(() => expect(appConfig.state.theme).toBe("gruvbox-dark"), { timeout: 2000 });
    expect(changes.at(-1)?.theme).toBe("gruvbox-dark");
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

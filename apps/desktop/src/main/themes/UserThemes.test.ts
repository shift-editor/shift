import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ColorTheme } from "../../shared/themes";
import { UserThemes } from "./UserThemes";

const palette = {
  base00: "#1d1f21",
  base01: "#282a2e",
  base02: "#373b41",
  base03: "#969896",
  base04: "#b4b7b4",
  base05: "#c5c8c6",
  base06: "#e0e0e0",
  base07: "#ffffff",
  base08: "#cc6666",
  base09: "#de935f",
  base0A: "#f0c674",
  base0B: "#b5bd68",
  base0C: "#8abeb7",
  base0D: "#81a2be",
  base0E: "#b294bb",
  base0F: "#a3685a",
};

const tomorrow: ColorTheme = {
  id: "user:tomorrow",
  name: "Tomorrow Night",
  appearance: "dark",
  palette,
};

describe("user themes persist as Base16 scheme files", () => {
  let root: string;
  let directory: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-themes-"));
    directory = path.join(root, "themes");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists a saved theme after a relaunch", () => {
    new UserThemes(directory).save(tomorrow);

    expect(new UserThemes(directory).list()).toEqual([tomorrow]);
  });

  it("replaces a theme saved again under the same id", () => {
    const themes = new UserThemes(directory);
    themes.save(tomorrow);
    themes.save({ ...tomorrow, name: "Tomorrow Night Bright" });

    expect(themes.list().map((theme) => theme.name)).toEqual(["Tomorrow Night Bright"]);
  });

  it("removes a theme and refuses ids outside the themes directory", () => {
    const themes = new UserThemes(directory);
    themes.save(tomorrow);

    expect(themes.remove("user:../themes/tomorrow")).toBe(false);
    expect(themes.remove(tomorrow.id)).toBe(true);
    expect(themes.list()).toEqual([]);
  });

  it("imports a classic YAML scheme under a fresh id beside an existing one", () => {
    const themes = new UserThemes(directory);
    themes.save(tomorrow);
    const source = path.join(root, "download.yaml");
    const colors = Object.entries(palette).map(([key, color]) => `${key}: "${color.slice(1)}"`);
    fs.writeFileSync(source, ['scheme: "Tomorrow"', ...colors].join("\n"));

    const imported = themes.import(source);

    expect(imported?.id).toBe("user:tomorrow-2");
    expect(themes.list().map((theme) => theme.id)).toEqual(["user:tomorrow-2", "user:tomorrow"]);
  });

  it("refuses to import an incomplete scheme and skips unreadable files in the folder", () => {
    const themes = new UserThemes(directory);
    themes.save(tomorrow);
    const source = path.join(root, "broken.json");
    fs.writeFileSync(source, JSON.stringify({ name: "Broken", base00: "#000000" }));
    fs.writeFileSync(path.join(directory, "garbage.yaml"), "{not: [yaml");

    expect(themes.import(source)).toBeNull();
    expect(themes.list()).toEqual([tomorrow]);
  });

  it("exports a theme that imports back unchanged", () => {
    const themes = new UserThemes(directory);
    const destination = path.join(root, "export.yaml");

    themes.export({ ...tomorrow, id: "nord" }, destination);

    expect({ ...themes.import(destination), id: tomorrow.id }).toEqual(tomorrow);
  });
});

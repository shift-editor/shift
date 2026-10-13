import { describe, expect, it } from "vitest";
import {
  applyResolvedTheme,
  colorThemes,
  defaultThemePreference,
  readThemeSetting,
  resolveTheme,
  themeById,
  writeThemeSetting,
  type ThemePreference,
} from ".";

describe("color themes", () => {
  it("provides unique built-in theme ids with complete palettes", () => {
    const ids = colorThemes.map((theme) => theme.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const theme of colorThemes) {
      expect(Object.keys(theme.palette)).toHaveLength(16);
      expect(Object.values(theme.palette).every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(
        true,
      );
    }
  });

  it("resolves system mode to the slot for the OS appearance", () => {
    const preference: ThemePreference = { mode: "system", light: "gruvbox-light", dark: "nord" };

    expect(resolveTheme(preference, "light").id).toBe("gruvbox-light");
    expect(resolveTheme(preference, "dark").id).toBe("nord");
  });

  it("uses the chosen mode's slot whatever the OS appearance", () => {
    const preference: ThemePreference = { mode: "dark", light: "gruvbox-light", dark: "nord" };

    expect(resolveTheme(preference, "light").id).toBe("nord");
  });
  it("keeps the toolbar distinct from the canvas and its hover in every override theme", () => {
    for (const theme of colorThemes.filter((theme) => theme.id !== "shift-light")) {
      const properties = new Map<string, string>();
      const root = {
        dataset: {},
        style: {
          colorScheme: "",
          setProperty: (name: string, value: string) => properties.set(name, value),
          removeProperty: () => "",
        },
      } as unknown as HTMLElement;

      applyResolvedTheme(theme, root);
      expect(properties.get("--color-icon-button-hover"), theme.id).not.toBe(
        properties.get("--color-chrome"),
      );
      expect(properties.get("--color-chrome"), theme.id).not.toBe(
        properties.get("--color-surface-muted"),
      );
    }
  });

  it("applies theme metadata and removes overrides for Shift Light", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {},
      style: {
        colorScheme: "",
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => {
          properties.delete(name);
          return "";
        },
      },
    } as unknown as HTMLElement;

    applyResolvedTheme(themeById("nord"), root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.colorTheme).toBe("nord");
    expect(properties.get("--color-background")).toBe("#2e3440");
    expect(properties.get("--editor-handle-primary-stroke")).toBe("#81a1c1");

    applyResolvedTheme(themeById("dracula"), root);
    expect(properties.get("--color-chrome")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--color-input")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--color-icon-button")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--color-icon-button-hover")).not.toBe(
      properties.get("--color-icon-button"),
    );
    expect(properties.get("--color-hover")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--color-surface-hover")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--color-line-subtle")).not.toBe(properties.get("--color-surface"));
    expect(properties.get("--editor-variation-outline-color")).toBe("rgba(139, 233, 253, 0.45)");
    expect(properties.get("--editor-read-only-lock-color")).toBe("#f8f8f2");
    // Dracula's accent is a pale cyan, so text on it must be dark, not white.
    expect(properties.get("--color-on-accent")).toBe(properties.get("--color-background"));

    // Solarized's mid-tone blue scores slightly higher with dark text, but its light base reads better.
    applyResolvedTheme(themeById("solarized-dark"), root);
    expect(properties.get("--color-on-accent")).toBe("#fdf6e3");

    // Text on Gruvbox Light's teal uses the palette's cream rather than pure white.
    applyResolvedTheme(themeById("gruvbox-light"), root);
    expect(properties.get("--color-on-accent")).toBe("#fbf1c7");

    applyResolvedTheme(themeById("shift-light"), root);
    expect(root.dataset.theme).toBe("light");
    expect(properties.has("--color-background")).toBe(false);
  });
});

describe("theme setting in config.toml", () => {
  it("reads a theme name as that theme in its own appearance", () => {
    expect(readThemeSetting("nord")).toEqual({
      preference: { mode: "dark", light: "shift-light", dark: "nord" },
      unknownThemes: [],
    });
    expect(readThemeSetting("system").preference).toEqual({
      ...defaultThemePreference,
      mode: "system",
    });
  });

  it("reads a table, defaulting a missing mode to system and missing slots to Shift's", () => {
    expect(readThemeSetting({ dark: "dracula" }).preference).toEqual({
      mode: "system",
      light: "shift-light",
      dark: "dracula",
    });
  });

  it("reports theme names Shift does not have and uses the defaults for them", () => {
    expect(readThemeSetting("rose-pine")).toEqual({
      preference: defaultThemePreference,
      unknownThemes: ["rose-pine"],
    });
    expect(readThemeSetting({ mode: "light", light: "latte", dark: "mocha" })).toEqual({
      preference: { mode: "light", light: "shift-light", dark: "shift-dark" },
      unknownThemes: ["latte", "mocha"],
    });
  });

  it("writes a name when the file has none or a name and the name reads back the same", () => {
    expect(writeThemeSetting({ mode: "dark", light: "shift-light", dark: "nord" }, null)).toBe(
      "nord",
    );
    expect(writeThemeSetting({ ...defaultThemePreference, mode: "system" }, "nord")).toBe("system");
  });

  it("writes a table when a name would lose the other slot", () => {
    const preference: ThemePreference = { mode: "dark", light: "gruvbox-light", dark: "nord" };

    expect(writeThemeSetting(preference, "gruvbox-light")).toEqual(preference);
  });

  it("keeps a table once the file has one", () => {
    const preference: ThemePreference = { mode: "dark", light: "shift-light", dark: "nord" };

    expect(writeThemeSetting(preference, { dark: "dracula" })).toEqual(preference);
  });

  it("round-trips every written setting", () => {
    const preferences: ThemePreference[] = [
      defaultThemePreference,
      { mode: "system", light: "solarized-light", dark: "one-dark" },
      { mode: "light", light: "gruvbox-light", dark: "nord" },
      { mode: "dark", light: "shift-light", dark: "dracula" },
    ];
    for (const preference of preferences) {
      for (const current of [null, "nord", { dark: "nord" }] as const) {
        const written = writeThemeSetting(preference, current);
        expect(readThemeSetting(written).preference).toEqual(preference);
      }
    }
  });
});

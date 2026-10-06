import { describe, expect, it } from "vitest";
import { applyResolvedTheme, colorThemes, defaultThemePreferences, resolveThemeSelection } from ".";
import type { ColorTheme, ThemeAppearance, ThemePreferences } from ".";

const select = (selection: string, appearance: ThemeAppearance = "light") =>
  resolveThemeSelection({ ...defaultThemePreferences, selection }, appearance);

const nord = colorThemes.find((theme) => theme.id === "nord");
if (!nord) throw new Error("Expected the Nord theme");

const userTheme: ColorTheme = {
  ...nord,
  id: "user:my-nord",
  name: "My Nord",
};

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

  it("resolves system selection to the matching Shift appearance by default", () => {
    expect(select("system", "light").id).toBe("shift-light");
    expect(select("system", "dark").id).toBe("shift-dark");
  });

  it("resolves system selection to the user's light and dark pair", () => {
    const preferences: ThemePreferences = {
      selection: "system",
      light: "gruvbox-light",
      dark: userTheme.id,
    };
    const themes = [...colorThemes, userTheme];

    expect(resolveThemeSelection(preferences, "light", themes).id).toBe("gruvbox-light");
    expect(resolveThemeSelection(preferences, "dark", themes).id).toBe("user:my-nord");
  });

  it("preserves explicit theme selections", () => {
    expect(select("solarized-dark", "light").id).toBe("solarized-dark");
    expect(select("gruvbox-light", "dark").id).toBe("gruvbox-light");
  });

  it("falls back to the system theme when a selected user theme no longer exists", () => {
    const preferences: ThemePreferences = {
      selection: "user:deleted",
      light: "nord",
      dark: "nord",
    };

    expect(resolveThemeSelection(preferences, "light").id).toBe("nord");
    expect(resolveThemeSelection({ ...preferences, light: "user:gone" }, "light").id).toBe(
      "shift-light",
    );
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

    applyResolvedTheme(select("nord", "light"), root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.colorTheme).toBe("nord");
    expect(properties.get("--color-background")).toBe("#2e3440");
    expect(properties.get("--editor-handle-primary-stroke")).toBe("#81a1c1");

    applyResolvedTheme(select("dracula", "light"), root);
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
    applyResolvedTheme(select("solarized-dark", "light"), root);
    expect(properties.get("--color-on-accent")).toBe("#fdf6e3");

    // Text on Gruvbox Light's teal uses the palette's cream rather than pure white.
    applyResolvedTheme(select("gruvbox-light", "dark"), root);
    expect(properties.get("--color-on-accent")).toBe("#fbf1c7");

    applyResolvedTheme(select("shift-light", "dark"), root);
    expect(root.dataset.theme).toBe("light");
    expect(properties.has("--color-background")).toBe(false);
  });
});

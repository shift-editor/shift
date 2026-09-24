import { describe, expect, it } from "vitest";
import { applyResolvedTheme, colorThemes, resolveThemeSelection } from ".";

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

  it("resolves system selection to the matching Shift appearance", () => {
    expect(resolveThemeSelection("system", "light").id).toBe("shift-light");
    expect(resolveThemeSelection("system", "dark").id).toBe("shift-dark");
  });

  it("preserves explicit theme selections", () => {
    expect(resolveThemeSelection("solarized-dark", "light").id).toBe("solarized-dark");
    expect(resolveThemeSelection("gruvbox-light", "dark").id).toBe("gruvbox-light");
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

    applyResolvedTheme(resolveThemeSelection("nord", "light"), root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.colorTheme).toBe("nord");
    expect(properties.get("--color-background")).toBe("#2e3440");
    expect(properties.get("--editor-handle-primary-stroke")).toBe("#81a1c1");

    applyResolvedTheme(resolveThemeSelection("shift-light", "dark"), root);
    expect(root.dataset.theme).toBe("light");
    expect(properties.has("--color-background")).toBe(false);
  });
});

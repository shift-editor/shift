import path from "node:path";
import { describe, expect, it } from "vitest";
import { descending } from "@shift/types";
import { readThemeFiles } from "../../../../main/config/themeFiles";
import { applyResolvedTheme, bundledColorThemes, colorThemes, type ColorTheme } from ".";

const BUNDLED_THEMES_DIRECTORY = path.resolve(__dirname, "../../../../../themes");

/** A color role, the color it sits on, and the WCAG contrast it needs. */
const CHECKS = [
  { role: "glyph", foreground: "--editor-glyph-stroke", background: "base00", minimum: 4.5 },
  { role: "text", foreground: "--color-primary", background: "--color-surface", minimum: 4.5 },
  { role: "dim text", foreground: "--color-secondary", background: "--color-surface", minimum: 3 },
  { role: "point", foreground: "--editor-handle-primary-stroke", background: "base00", minimum: 3 },
  {
    role: "handle",
    foreground: "--editor-handle-control-stroke",
    background: "base00",
    minimum: 3,
  },
  { role: "anchor", foreground: "--editor-handle-anchor-stroke", background: "base00", minimum: 3 },
  { role: "snap", foreground: "--editor-snap-color", background: "base00", minimum: 3 },
  {
    role: "on accent",
    foreground: "--color-on-accent",
    background: "--color-accent",
    minimum: 4.5,
  },
  { role: "guides", foreground: "--editor-guides-color", background: "base00", minimum: 1.5 },
] as const;

/** Built-in palettes that predate this check; tracked separately rather than hidden. */
const KNOWN_FAILURES: Readonly<Record<string, readonly string[]>> = {
  "solarized-light": ["on accent"],
  "solarized-dark": ["on accent"],
};

describe("theme contrast", () => {
  const files = readThemeFiles(BUNDLED_THEMES_DIRECTORY, new Map());
  const bundled = bundledColorThemes(files);

  it("reads every bundled theme file without problems or clashing ids", () => {
    expect(files.flatMap(({ id, problems }) => problems.map((problem) => [id, problem]))).toEqual(
      [],
    );
    expect(bundled).toHaveLength(files.length);
    const ids = [...colorThemes, ...bundled].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const theme of [...colorThemes, ...bundled]) {
    it(`${theme.id} keeps glyphs, text, and handles readable`, () => {
      const failures = contrastFailures(theme).filter(
        ({ role }) => !KNOWN_FAILURES[theme.id]?.includes(role),
      );
      expect(failures).toEqual([]);
    });
  }
});

interface ContrastFailure {
  role: string;
  /** The measured ratio against the required one, such as `2.1 < 3`. */
  ratio: string;
}

function contrastFailures(theme: ColorTheme): ContrastFailure[] {
  const variables = themeVariables(theme);
  const color = (name: string) =>
    name.startsWith("--")
      ? variables.get(name)
      : theme.palette[name as keyof ColorTheme["palette"]];
  return CHECKS.flatMap(({ role, foreground, background, minimum }) => {
    const base = color(background);
    const top = color(foreground);
    if (!base || !top) throw new Error(`${theme.id} has no ${foreground} or ${background}`);
    const measured = contrast(top, base);
    return measured < minimum ? [{ role, ratio: `${measured.toFixed(2)} < ${minimum}` }] : [];
  });
}

/** The CSS variables `applyResolvedTheme` writes, with Shift Light's stylesheet defaults filled in. */
function themeVariables(theme: ColorTheme): Map<string, string> {
  const properties = new Map<string, string>();
  const root = {
    dataset: {},
    style: {
      colorScheme: "",
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: () => "",
    },
  } as unknown as HTMLElement;
  // Shift Light keeps the stylesheet defaults, so map it as any other light palette here.
  applyResolvedTheme(
    { ...theme, id: theme.id === "shift-light" ? "shift-light-check" : theme.id },
    root,
  );
  return properties;
}

function contrast(foreground: string, background: string): number {
  const below = rgba(background);
  const top = rgba(foreground);
  const blended = top
    .slice(0, 3)
    .map((channel, index) => channel * top[3] + below[index] * (1 - top[3]));
  const [lighter, darker] = [luminance(blended), luminance(below)].sort(descending);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgba(color: string): [number, number, number, number] {
  const functional = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color);
  if (functional) {
    const [, red, green, blue, alpha] = functional;
    return [Number(red), Number(green), Number(blue), alpha === undefined ? 1 : Number(alpha)];
  }
  const hex = color.slice(1);
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    .concat(alpha) as [number, number, number, number];
}

function luminance(channels: readonly number[]): number {
  const [red, green, blue] = channels.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

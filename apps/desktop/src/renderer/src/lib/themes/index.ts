import type { ThemeAppearance } from "@shift/types";
import type { ThemeFile, ThemeFileState, ThemeSetting } from "@shared/config/config";

export type { ThemeAppearance };

export type ThemeId =
  | "shift-light"
  | "shift-dark"
  | "solarized-light"
  | "solarized-dark"
  | "dracula"
  | "nord"
  | "gruvbox-light"
  | "gruvbox-dark"
  | "one-dark";

export interface ColorTheme {
  /** A built-in {@link ThemeId}, or a user theme's file name without `.toml`. */
  readonly id: string;
  readonly name: string;
  /** The theme file, for a user theme. */
  readonly file?: string;
  /**
   * Overrides of derived colors by name, such as `accent` for `--color-accent`
   * or `editor-handle-primary-stroke` for `--editor-handle-primary-stroke`.
   */
  readonly colors?: Readonly<Record<string, string>>;
  readonly appearance: ThemeAppearance;
  readonly palette: {
    readonly base00: string;
    readonly base01: string;
    readonly base02: string;
    readonly base03: string;
    readonly base04: string;
    readonly base05: string;
    readonly base06: string;
    readonly base07: string;
    readonly base08: string;
    readonly base09: string;
    readonly base0A: string;
    readonly base0B: string;
    readonly base0C: string;
    readonly base0D: string;
    readonly base0E: string;
    readonly base0F: string;
  };
}

export const colorThemes: readonly ColorTheme[] = [
  {
    id: "shift-light",
    name: "Shift Light",
    appearance: "light",
    palette: {
      base00: "#ffffff",
      base01: "#f2f2f2",
      base02: "#e2e2e2",
      base03: "#5f5f5f",
      base04: "#898989",
      base05: "#171717",
      base06: "#2c2c2c",
      base07: "#000000",
      base08: "#dc2626",
      base09: "#f97316",
      base0A: "#d79921",
      base0B: "#22c55e",
      base0C: "#06b6d4",
      base0D: "#0c92f4",
      base0E: "#8b5cf6",
      base0F: "#f219d1",
    },
  },
  {
    id: "shift-dark",
    name: "Shift Dark",
    appearance: "dark",
    palette: {
      base00: "#181818",
      base01: "#202020",
      base02: "#2d2d2d",
      base03: "#737373",
      base04: "#a3a3a3",
      base05: "#ededed",
      base06: "#f5f5f5",
      base07: "#ffffff",
      base08: "#ff6b6b",
      base09: "#ff9f43",
      base0A: "#ffd166",
      base0B: "#6ddc8b",
      base0C: "#64d8e8",
      base0D: "#4da8ff",
      base0E: "#a78bfa",
      base0F: "#ff79c6",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    appearance: "light",
    palette: {
      base00: "#fdf6e3",
      base01: "#eee8d5",
      base02: "#93a1a1",
      base03: "#839496",
      base04: "#657b83",
      base05: "#586e75",
      base06: "#073642",
      base07: "#002b36",
      base08: "#dc322f",
      base09: "#cb4b16",
      base0A: "#b58900",
      base0B: "#859900",
      base0C: "#2aa198",
      base0D: "#268bd2",
      base0E: "#6c71c4",
      base0F: "#d33682",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    appearance: "dark",
    palette: {
      base00: "#002b36",
      base01: "#073642",
      base02: "#586e75",
      base03: "#657b83",
      base04: "#839496",
      base05: "#93a1a1",
      base06: "#eee8d5",
      base07: "#fdf6e3",
      base08: "#dc322f",
      base09: "#cb4b16",
      base0A: "#b58900",
      base0B: "#859900",
      base0C: "#2aa198",
      base0D: "#268bd2",
      base0E: "#6c71c4",
      base0F: "#d33682",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    appearance: "dark",
    palette: {
      base00: "#282a36",
      base01: "#44475a",
      base02: "#44475a",
      base03: "#6272a4",
      base04: "#8be9fd",
      base05: "#f8f8f2",
      base06: "#f8f8f2",
      base07: "#ffffff",
      base08: "#ff5555",
      base09: "#ffb86c",
      base0A: "#f1fa8c",
      base0B: "#50fa7b",
      base0C: "#8be9fd",
      base0D: "#8be9fd",
      base0E: "#bd93f9",
      base0F: "#ff79c6",
    },
  },
  {
    id: "nord",
    name: "Nord",
    appearance: "dark",
    palette: {
      base00: "#2e3440",
      base01: "#3b4252",
      base02: "#434c5e",
      base03: "#4c566a",
      base04: "#d8dee9",
      base05: "#e5e9f0",
      base06: "#eceff4",
      base07: "#8fbcbb",
      base08: "#bf616a",
      base09: "#d08770",
      base0A: "#ebcb8b",
      base0B: "#a3be8c",
      base0C: "#88c0d0",
      base0D: "#81a1c1",
      base0E: "#b48ead",
      base0F: "#5e81ac",
    },
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    appearance: "light",
    palette: {
      base00: "#fbf1c7",
      base01: "#ebdbb2",
      base02: "#d5c4a1",
      base03: "#bdae93",
      base04: "#665c54",
      base05: "#3c3836",
      base06: "#282828",
      base07: "#1d2021",
      base08: "#9d0006",
      base09: "#af3a03",
      base0A: "#b57614",
      base0B: "#79740e",
      base0C: "#427b58",
      base0D: "#076678",
      base0E: "#8f3f71",
      base0F: "#d65d0e",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    appearance: "dark",
    palette: {
      base00: "#282828",
      base01: "#3c3836",
      base02: "#504945",
      base03: "#665c54",
      base04: "#a89984",
      base05: "#ebdbb2",
      base06: "#fbf1c7",
      base07: "#f9f5d7",
      base08: "#fb4934",
      base09: "#fe8019",
      base0A: "#fabd2f",
      base0B: "#b8bb26",
      base0C: "#8ec07c",
      base0D: "#83a598",
      base0E: "#d3869b",
      base0F: "#d65d0e",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    appearance: "dark",
    palette: {
      base00: "#282c34",
      base01: "#2c313c",
      base02: "#3e4451",
      base03: "#5c6370",
      base04: "#828997",
      base05: "#abb2bf",
      base06: "#d7dae0",
      base07: "#ffffff",
      base08: "#e06c75",
      base09: "#d19a66",
      base0A: "#e5c07b",
      base0B: "#98c379",
      base0C: "#56b6c2",
      base0D: "#61afef",
      base0E: "#c678dd",
      base0F: "#be5046",
    },
  },
];

/** Whether Shift follows the OS appearance or always uses one. */
export type ThemeMode = "system" | ThemeAppearance;

/** The mode and the theme id each appearance uses; what Settings shows and edits. */
export interface ThemePreference {
  readonly mode: ThemeMode;
  readonly light: string;
  readonly dark: string;
}

/** Used when `config.toml` chooses no theme. */
export const defaultThemePreference: ThemePreference = {
  mode: "light",
  light: "shift-light",
  dark: "shift-dark",
};

const PALETTE_KEYS = [
  "base00",
  "base01",
  "base02",
  "base03",
  "base04",
  "base05",
  "base06",
  "base07",
  "base08",
  "base09",
  "base0A",
  "base0B",
  "base0C",
  "base0D",
  "base0E",
  "base0F",
] as const satisfies readonly (keyof ColorTheme["palette"])[];

/** The user themes Shift can show, and the files it ignores for reusing a reserved id. */
export interface UserColorThemes {
  readonly themes: readonly ColorTheme[];
  /** Files named like a built-in theme or `system`, which would be ambiguous in `config.toml`. */
  readonly shadowing: readonly ThemeFileState[];
  /** Override names in each file that name no color Shift derives; they are ignored. */
  readonly unknownColors: readonly UnknownThemeColors[];
}

export interface UnknownThemeColors {
  readonly file: ThemeFileState;
  readonly names: readonly string[];
}

/**
 * Turns the user's theme files into themes, skipping files that have never been valid.
 *
 * @remarks
 * A file named like a built-in or bundled theme, or `system`, is ignored rather
 * than replacing it, so `theme = "nord"` always means the same theme. Every call
 * returns new theme objects, which is what tells the renderers to redraw after a
 * file is edited.
 *
 * @param reserved - the themes Shift ships, whose ids user files may not take.
 */
export function userColorThemes(
  files: readonly ThemeFileState[],
  reserved: readonly ColorTheme[] = colorThemes,
): UserColorThemes {
  const themes: ColorTheme[] = [];
  const shadowing: ThemeFileState[] = [];
  const unknownColors: UnknownThemeColors[] = [];
  for (const file of files) {
    if (file.id === "system" || reserved.some((theme) => theme.id === file.id)) {
      shadowing.push(file);
      continue;
    }
    if (!file.theme) continue;

    const unknown = Object.keys(file.theme.colors).filter((name) => !COLOR_VARIABLES.has(name));
    if (unknown.length > 0) unknownColors.push({ file, names: unknown });
    themes.push({ ...colorThemeFromFile(file.id, file.theme), file: file.path });
  }
  return { themes, shadowing, unknownColors };
}

/**
 * Turns the theme files shipped with Shift into themes. They are read-only and
 * listed with the built-in themes, so they carry no `file`.
 */
export function bundledColorThemes(files: readonly ThemeFileState[]): ColorTheme[] {
  return files.flatMap((file) => (file.theme ? [colorThemeFromFile(file.id, file.theme)] : []));
}

function colorThemeFromFile(id: string, theme: ThemeFile): ColorTheme {
  const palette = Object.fromEntries(
    PALETTE_KEYS.map((key, index) => [key, theme.palette[index]]),
  ) as ColorTheme["palette"];
  return {
    id,
    name: theme.name ?? id,
    appearance: theme.appearance,
    palette,
    colors: theme.colors,
  };
}

/** Returns theme `id` among `themes`, or Shift Light for an id Shift does not have. */
export function themeById(id: string, themes: readonly ColorTheme[] = colorThemes): ColorTheme {
  return themes.find((theme) => theme.id === id) ?? colorThemes[0];
}

/** A preference read from `config.toml`, with any theme names Shift does not have. */
export interface ThemePreferenceRead {
  preference: ThemePreference;
  /** Names that fell back to the default, in file order. */
  unknownThemes: string[];
}

/**
 * Reads the `theme` setting from `config.toml`.
 *
 * @remarks
 * `theme = "nord"` uses Nord in its own appearance, keeping the default for
 * the other; `theme = "system"` follows the OS with the defaults. A table's
 * missing mode means `system`, and a missing or unknown slot keeps its default.
 */
export function readThemeSetting(
  setting: ThemeSetting | null,
  themes: readonly ColorTheme[] = colorThemes,
): ThemePreferenceRead {
  const isKnown = (id: string) => themes.some((theme) => theme.id === id);
  if (setting === null) return { preference: defaultThemePreference, unknownThemes: [] };

  if (typeof setting === "string") {
    if (setting === "system") {
      return { preference: { ...defaultThemePreference, mode: "system" }, unknownThemes: [] };
    }
    if (!isKnown(setting)) {
      return { preference: defaultThemePreference, unknownThemes: [setting] };
    }
    const { appearance } = themeById(setting, themes);
    return {
      preference: { ...defaultThemePreference, mode: appearance, [appearance]: setting },
      unknownThemes: [],
    };
  }

  const unknownThemes: string[] = [];
  const slot = (appearance: ThemeAppearance): string => {
    const name = setting[appearance];
    if (name === undefined) return defaultThemePreference[appearance];
    if (isKnown(name)) return name;
    unknownThemes.push(name);
    return defaultThemePreference[appearance];
  };
  return {
    preference: { mode: setting.mode ?? "system", light: slot("light"), dark: slot("dark") },
    unknownThemes,
  };
}

/**
 * Returns the `theme` setting that saves `preference`.
 *
 * @remarks
 * Keeps the file's form: a file with a `theme` table keeps a table. Otherwise
 * a preference that `theme = "…"` reads back exactly is written as a name, so
 * most files stay one line; anything else becomes a table.
 */
export function writeThemeSetting(
  preference: ThemePreference,
  current: ThemeSetting | null,
  themes: readonly ColorTheme[] = colorThemes,
): ThemeSetting {
  const table: ThemeSetting = { ...preference };
  if (current !== null && typeof current !== "string") return table;

  const name = preference.mode === "system" ? "system" : preference[preference.mode];
  const roundTrip = readThemeSetting(name, themes).preference;
  return isSamePreference(roundTrip, preference) ? name : table;
}

function isSamePreference(a: ThemePreference, b: ThemePreference): boolean {
  return a.mode === b.mode && a.light === b.light && a.dark === b.dark;
}

/** The theme `preference` shows while the OS is in `systemAppearance`. */
export function resolveTheme(
  preference: ThemePreference,
  systemAppearance: ThemeAppearance,
  themes: readonly ColorTheme[] = colorThemes,
): ColorTheme {
  const appearance = preference.mode === "system" ? systemAppearance : preference.mode;
  return themeById(preference[appearance], themes);
}

export function applyResolvedTheme(
  resolvedTheme: ColorTheme,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  if (!root) return;

  root.dataset.theme = resolvedTheme.appearance;
  root.dataset.colorTheme = resolvedTheme.id;
  root.style.colorScheme = resolvedTheme.appearance;

  const variables = themeVariables(resolvedTheme);
  for (const [name, value] of Object.entries(variables)) {
    if (resolvedTheme.id === "shift-light") root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

/** The CSS variables for `theme`: derived from its palette, then its overrides. */
function themeVariables(theme: ColorTheme): Record<string, string> {
  const variables = colorThemeVariables(theme);
  for (const [name, value] of Object.entries(theme.colors ?? {})) {
    const variable = COLOR_VARIABLES.get(name);
    if (variable) variables[variable] = value;
  }
  return variables;
}

/** `accent` for `--color-accent`, `editor-snap-color` for `--editor-snap-color`. */
function colorName(variable: string): string {
  return variable.replace(/^--color-/, "").replace(/^--/, "");
}

function colorThemeVariables(theme: ColorTheme): Record<string, string> {
  const { palette } = theme;
  const dark = theme.appearance === "dark";
  const glyphForeground = dark ? palette.base06 : lightGlyphForeground(palette);
  const secondary = dark ? withAlpha(palette.base05, 0.78) : lightSecondary(palette);
  const muted = dark ? withAlpha(palette.base05, 0.6) : palette.base03;
  const handleOverlay = dark ? palette.base07 : palette.base00;
  const surface = dark ? palette.base01 : palette.base00;
  // Light palettes put a strong selection colour in base02, so light chrome tints the canvas (base01)
  // toward the text colour instead; on Shift Light's palette this reproduces its #e2e2e2 chrome.
  const darkChrome = palette.base02 === surface ? withAlpha(palette.base05, 0.08) : palette.base02;
  const chrome = dark ? darkChrome : mix(palette.base01, palette.base05, 0.07);

  return {
    "--color-background": palette.base00,
    "--color-surface": surface,
    "--color-surface-muted": palette.base01,
    "--color-chrome": chrome,
    "--color-hover": withAlpha(palette.base05, dark ? 0.16 : 0.1),
    "--color-surface-hover": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-surface-inverse": palette.base07,
    "--color-on-surface-inverse": palette.base00,
    "--color-input": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-icon-button": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-icon-button-hover": withAlpha(palette.base05, dark ? 0.2 : 0.14),
    "--color-line": dark ? palette.base03 : palette.base06,
    "--color-line-subtle": dark ? withAlpha(palette.base05, 0.2) : palette.base01,
    "--color-shadow-ambient": dark ? "rgba(0, 0, 0, 0.55)" : "rgba(50, 50, 93, 0.25)",
    "--color-shadow-key": dark ? "rgba(0, 0, 0, 0.7)" : "rgba(0, 0, 0, 0.3)",
    "--color-primary": palette.base05,
    "--color-secondary": secondary,
    "--color-muted": muted,
    "--color-sidebar-icon": secondary,
    "--color-accent": palette.base0D,
    "--color-on-accent": readableOn(palette.base0D, [
      lightest(palette.base00, palette.base07),
      darkest(palette.base00, palette.base07),
    ]),
    "--color-error": palette.base08,
    "--color-error-ring": palette.base08,
    "--color-destructive": palette.base08,
    "--color-destructive-hover": withAlpha(palette.base08, dark ? 0.18 : 0.1),
    "--color-icon-subtle": muted,
    "--color-control-muted": secondary,
    "--color-canvas-purple": palette.base0E,
    "--color-canvas-orange": palette.base09,
    "--color-canvas-green": palette.base0B,
    "--color-canvas-indigo": palette.base0E,
    "--color-canvas-blue": palette.base0D,
    "--color-canvas-cyan": palette.base0C,
    "--editor-cursor-color": palette.base0D,
    "--editor-guides-color": withAlpha(palette.base0D, 0.5),
    "--editor-metric-marker-fill": withAlpha(palette.base05, dark ? 0.22 : 0.1),
    "--editor-selection-fill": withAlpha(palette.base0D, 0.12),
    "--editor-selection-stroke": withAlpha(palette.base0D, 0.55),
    "--editor-glyph-fill": glyphForeground,
    "--editor-glyph-editable-fill": withAlpha(glyphForeground, 0.14),
    "--editor-glyph-stroke": glyphForeground,
    "--editor-component-fill": withAlpha(palette.base04, 0.38),
    "--editor-control-line-color": muted,
    "--editor-handle-fill": palette.base00,
    "--editor-handle-interpolated-stroke": withAlpha(glyphForeground, 0.65),
    "--editor-handle-primary-stroke": palette.base0D,
    "--editor-handle-control-stroke": secondary,
    "--editor-handle-anchor-stroke": palette.base0E,
    "--editor-handle-overlay-subtle": withAlpha(handleOverlay, 0.1),
    "--editor-handle-overlay-first": withAlpha(handleOverlay, 0.3),
    "--editor-handle-overlay-last": withAlpha(handleOverlay, 0.5),
    "--editor-handle-overlay-anchor": withAlpha(handleOverlay, 0.75),
    "--editor-snap-color": palette.base08,
    "--editor-segment-hover-color": palette.base0D,
    "--editor-component-hover-outline": palette.base0D,
    "--editor-segment-selected-color": palette.base0D,
    "--editor-preview-color": palette.base0D,
    "--editor-variation-outline-color": withAlpha(palette.base0D, 0.45),
    "--editor-edit-ghost-color": withAlpha(glyphForeground, 0.12),
    "--editor-advance-tee-color": withAlpha(glyphForeground, 0.45),
    "--editor-read-only-lock-color": palette.base05,
    "--editor-pen-ready-fill": palette.base00,
    "--editor-pen-ready-stroke": palette.base0D,
    "--editor-debug-tight-bounds": palette.base08,
    "--editor-debug-hit-radii": palette.base0D,
    "--editor-debug-segment-bounds": palette.base09,
    "--editor-debug-glyph-bbox": palette.base0F,
    "--editor-text-cursor-color": palette.base0D,
    "--editor-text-selection-fill": withAlpha(palette.base0D, 0.22),
    "--editor-text-hover-outline": palette.base0D,
    // Spacing keeps one pink identity and amber for negatives; the faint half needs more
    // weight on light backgrounds to stay visible.
    "--editor-spacing": dark ? "#F472B6" : "#DB2E91",
    "--editor-spacing-faint": withAlpha(dark ? "#F472B6" : "#DB2E91", dark ? 0.3 : 0.45),
    "--editor-spacing-negative": dark ? "#FBBF24" : "#D97706",
    "--editor-spacing-negative-faint": withAlpha(dark ? "#FBBF24" : "#D97706", dark ? 0.35 : 0.5),
    // Kerning has its own violet for a tightening kern and teal for a loosening
    // one, so it never reads as a spacing half.
    "--editor-kerning": dark ? "#A78BFA" : "#7C3AED",
    "--editor-kerning-positive": dark ? "#2DD4BF" : "#0D9488",
    // Interpolated spacing and kerning are read-only, like interpolated points: neutral grey.
    "--editor-interpolated": dark ? "#9CA3AF" : "#8A8A8A",
    "--editor-text-composite-arm-fill": withAlpha(palette.base04, 0.22),
    "--editor-text-component-overlay-a": withAlpha(palette.base0B, 0.26),
    "--editor-text-component-overlay-b": withAlpha(palette.base0F, 0.26),
    "--editor-text-component-overlay-hover-a": withAlpha(palette.base0B, 0.4),
    "--editor-text-component-overlay-hover-b": withAlpha(palette.base0F, 0.4),
  };
}

/** How close a preferred candidate's contrast must come to the best one to still win. */
const PREFERRED_CONTRAST_MARGIN = 0.8;

/**
 * Picks the candidate with the highest WCAG contrast on `background`, except that the
 * first candidate wins whenever it comes within 20% of the best. WCAG contrast
 * over-favours dark text on saturated mid-tone accents, where light text reads better.
 */
function readableOn(background: string, [preferred, ...others]: readonly string[]): string {
  const contrast = (color: string) => contrastRatio(color, background);
  const best = others.reduce(
    (best, color) => (contrast(color) > contrast(best) ? color : best),
    preferred,
  );
  return contrast(preferred) >= contrast(best) * PREFERRED_CONTRAST_MARGIN ? preferred : best;
}

/**
 * A light theme's glyph color: whichever of `base05`–`base07` contrasts most with
 * the canvas. Base16 puts the darkest text in `base07` by convention, but many light
 * palettes use it for an accent or a pale tint instead.
 */
function lightGlyphForeground(palette: ColorTheme["palette"]): string {
  const candidates = [palette.base07, palette.base06, palette.base05];
  return candidates.reduce((best, color) =>
    contrastRatio(color, palette.base00) > contrastRatio(best, palette.base00) ? color : best,
  );
}

/**
 * A light theme's secondary text and control-handle color: `base04`, darkened toward
 * `base05` in quarter steps until it reaches 3:1 on the canvas. Light palettes often
 * make `base04` too pale to see.
 */
function lightSecondary(palette: ColorTheme["palette"]): string {
  const steps = SECONDARY_DARKENING_STEPS.map((amount) =>
    mix(palette.base04, palette.base05, amount),
  );
  const readable = steps.find(
    (color) => contrastRatio(color, palette.base00) >= MINIMUM_SECONDARY_CONTRAST,
  );
  return readable ?? palette.base05;
}

const SECONDARY_DARKENING_STEPS = [0, 0.25, 0.5, 0.75] as const;
const MINIMUM_SECONDARY_CONTRAST = 3;

/** WCAG contrast ratio between two `#rrggbb` colors. */
function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function lightest(first: string, second: string): string {
  return relativeLuminance(first) >= relativeLuminance(second) ? first : second;
}

function darkest(first: string, second: string): string {
  return relativeLuminance(first) <= relativeLuminance(second) ? first : second;
}

function relativeLuminance(color: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function mix(color: string, tint: string, amount: number): string {
  const channel = (offset: number) => {
    const base = Number.parseInt(color.slice(offset, offset + 2), 16);
    const target = Number.parseInt(tint.slice(offset, offset + 2), 16);
    return Math.round(base + (target - base) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function withAlpha(color: string, alpha: number): string {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Override name → CSS variable, for every color a theme derives. */
const COLOR_VARIABLES: ReadonlyMap<string, string> = new Map(
  Object.keys(colorThemeVariables(colorThemes[0])).map((variable) => [
    colorName(variable),
    variable,
  ]),
);

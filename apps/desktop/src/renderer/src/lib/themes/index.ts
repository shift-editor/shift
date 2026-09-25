export type ThemeAppearance = "light" | "dark";

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

export type ThemeSelection = "system" | ThemeId;

export interface ColorTheme {
  readonly id: ThemeId;
  readonly name: string;
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

export function resolveThemeSelection(
  themeSelection: ThemeSelection,
  systemAppearance: ThemeAppearance,
): ColorTheme {
  const themeId =
    themeSelection === "system"
      ? systemAppearance === "dark"
        ? "shift-dark"
        : "shift-light"
      : themeSelection;
  return colorThemes.find((theme) => theme.id === themeId) ?? colorThemes[0];
}

export function applyResolvedTheme(
  resolvedTheme: ColorTheme,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): void {
  if (!root) return;

  root.dataset.theme = resolvedTheme.appearance;
  root.dataset.colorTheme = resolvedTheme.id;
  root.style.colorScheme = resolvedTheme.appearance;

  const variables = colorThemeVariables(resolvedTheme);
  for (const [name, value] of Object.entries(variables)) {
    if (resolvedTheme.id === "shift-light") root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

function colorThemeVariables(theme: ColorTheme): Record<string, string> {
  const { palette } = theme;
  const dark = theme.appearance === "dark";
  const glyphForeground = dark ? palette.base06 : palette.base07;
  const secondary = dark ? withAlpha(palette.base05, 0.78) : palette.base04;
  const muted = dark ? withAlpha(palette.base05, 0.6) : palette.base03;
  const handleOverlay = dark ? palette.base07 : palette.base00;

  return {
    "--color-background": palette.base00,
    "--color-surface": dark ? palette.base01 : palette.base00,
    "--color-surface-muted": palette.base01,
    "--color-chrome": palette.base02,
    "--color-hover": dark ? withAlpha(palette.base05, 0.16) : palette.base02,
    "--color-surface-hover": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-surface-inverse": palette.base07,
    "--color-on-surface-inverse": palette.base00,
    "--color-input": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-icon-button": dark ? withAlpha(palette.base05, 0.12) : palette.base01,
    "--color-icon-button-hover": dark ? withAlpha(palette.base05, 0.2) : palette.base02,
    "--color-line": dark ? palette.base03 : palette.base06,
    "--color-line-subtle": dark ? withAlpha(palette.base05, 0.2) : palette.base01,
    "--color-primary": palette.base05,
    "--color-secondary": secondary,
    "--color-muted": muted,
    "--color-sidebar-icon": secondary,
    "--color-accent": palette.base0D,
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
    "--editor-selection-fill": withAlpha(palette.base0D, 0.12),
    "--editor-selection-stroke": withAlpha(palette.base0D, 0.55),
    "--editor-glyph-fill": glyphForeground,
    "--editor-glyph-editable-fill": withAlpha(glyphForeground, 0.14),
    "--editor-glyph-stroke": glyphForeground,
    "--editor-component-fill": withAlpha(palette.base04, 0.38),
    "--editor-control-line-color": withAlpha(palette.base03, 0.72),
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
    "--editor-segment-selected-color": palette.base0D,
    "--editor-preview-color": palette.base0D,
    "--editor-pen-ready-fill": palette.base00,
    "--editor-pen-ready-stroke": palette.base0D,
    "--editor-debug-tight-bounds": palette.base08,
    "--editor-debug-hit-radii": palette.base0D,
    "--editor-debug-segment-bounds": palette.base09,
    "--editor-debug-glyph-bbox": palette.base0F,
    "--editor-text-cursor-color": palette.base0D,
    "--editor-text-selection-fill": withAlpha(palette.base0D, 0.22),
    "--editor-text-hover-outline": palette.base0D,
    "--editor-text-composite-arm-fill": withAlpha(palette.base04, 0.22),
    "--editor-text-component-overlay-a": withAlpha(palette.base0B, 0.26),
    "--editor-text-component-overlay-b": withAlpha(palette.base0F, 0.26),
    "--editor-text-component-overlay-hover-a": withAlpha(palette.base0B, 0.4),
    "--editor-text-component-overlay-hover-b": withAlpha(palette.base0F, 0.4),
  };
}

function withAlpha(color: string, alpha: number): string {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

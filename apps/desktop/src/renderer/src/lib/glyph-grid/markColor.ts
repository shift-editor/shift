import type { MarkColor, NamedMarkColor } from "@shift/types";

/** The seven colours offered first wherever a glyph is tagged, in swatch order. */
export const MAIN_MARK_COLORS = [
  "red",
  "orange",
  "yellow",
  "darkGreen",
  "darkBlue",
  "purple",
  "magenta",
] as const satisfies readonly NamedMarkColor[];

/** The other five named colours, offered under More. */
export const MORE_MARK_COLORS = [
  "brown",
  "lightGreen",
  "lightBlue",
  "lightGray",
  "charcoal",
] as const satisfies readonly NamedMarkColor[];

/**
 * All twelve named colours as a picker grid shows them, four to a row: by
 * hue across the rows (warm, then green and blue, then purple and pink), the
 * two greys last.
 */
export const GRID_MARK_COLORS = [
  "red",
  "orange",
  "brown",
  "yellow",
  "lightGreen",
  "darkGreen",
  "lightBlue",
  "darkBlue",
  "purple",
  "magenta",
  "lightGray",
  "charcoal",
] as const satisfies readonly NamedMarkColor[];

/**
 * Each named colour's theme token, the name people read, and whether its name
 * reads in light or dark ink. The palette is laid out in OKLCH: the main hues
 * are spaced evenly round the wheel at one lightness, dark enough that white
 * ink clears 4.5:1, while yellow, orange and the light tints take dark ink.
 */
const NAMED: Record<
  NamedMarkColor,
  { readonly token: string; readonly label: string; readonly lightInk: boolean }
> = {
  red: { token: "--color-tag-red", label: "red", lightInk: true },
  orange: { token: "--color-tag-orange", label: "orange", lightInk: false },
  brown: { token: "--color-tag-brown", label: "brown", lightInk: true },
  yellow: { token: "--color-tag-yellow", label: "yellow", lightInk: false },
  lightGreen: { token: "--color-tag-light-green", label: "light green", lightInk: false },
  darkGreen: { token: "--color-tag-green", label: "green", lightInk: true },
  lightBlue: { token: "--color-tag-light-blue", label: "light blue", lightInk: false },
  darkBlue: { token: "--color-tag-blue", label: "blue", lightInk: true },
  purple: { token: "--color-tag-purple", label: "purple", lightInk: true },
  magenta: { token: "--color-tag-pink", label: "pink", lightInk: true },
  lightGray: { token: "--color-tag-light-gray", label: "light gray", lightInk: false },
  charcoal: { token: "--color-tag-charcoal", label: "charcoal", lightInk: true },
};

/** The ink a name reads in on a tag colour; tag colours are the same in every theme, so is it. */
const LIGHT_INK = "#ffffff";
const DARK_INK = "#1c1c1e";
/** The luminance where white and near-black ink contrast equally with a colour. */
const INK_LUMINANCE_SPLIT = 0.179;

/**
 * What a glyph is filed under by colour: a named colour's name, a custom
 * colour's channels, or {@link UNTAGGED} for a glyph with no colour.
 */
export type MarkColorKey = string;

/** The {@link MarkColorKey} of glyphs with no colour. */
export const UNTAGGED: MarkColorKey = "none";

/** The key two glyphs share exactly when they are tagged alike. */
export function markColorKey(color: MarkColor | null | undefined): MarkColorKey {
  if (!color) return UNTAGGED;

  switch (color.kind) {
    case "named":
      return color.named;
    case "custom": {
      const { red, green, blue, alpha } = color.custom;
      return `${red},${green},${blue},${alpha}`;
    }
  }
}

/** The colour's name as people read it: `green`, or `custom` for one outside the twelve. */
export function markColorLabel(color: MarkColor): string {
  return color.kind === "named" ? NAMED[color.named].label : "custom";
}

/**
 * The colour as CSS: a named colour is its theme token, so a theme may
 * restyle it, and a custom colour is its own value.
 */
export function markColorCss(color: MarkColor): string {
  if (color.kind === "named") return `var(${NAMED[color.named].token})`;

  const { red, green, blue, alpha } = color.custom;
  const channel = (value: number) => Math.round(value * 255);
  return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${alpha})`;
}

/**
 * The colour resolved against an element's theme, for drawing on a canvas,
 * which cannot read a token.
 */
export function resolvedMarkColor(color: MarkColor, style: CSSStyleDeclaration): string {
  if (color.kind === "custom") return markColorCss(color);

  return style.getPropertyValue(NAMED[color.named].token).trim();
}

/** The ink a glyph's name reads in on a band of this colour: white on a dark colour, near-black on a light one. */
export function markColorInk(color: MarkColor): string {
  if (color.kind === "named") return NAMED[color.named].lightInk ? LIGHT_INK : DARK_INK;

  const { red, green, blue } = color.custom;
  return relativeLuminance(red, green, blue) < INK_LUMINANCE_SPLIT ? LIGHT_INK : DARK_INK;
}

/** WCAG relative luminance of an sRGB colour whose channels run from 0 to 1. */
function relativeLuminance(red: number, green: number, blue: number): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

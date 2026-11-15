import type { MarkColor, NamedMarkColor } from "@shift/types";

/** Each named colour's theme token and the name people read. */
const NAMED: Record<NamedMarkColor, { readonly token: string; readonly label: string }> = {
  red: { token: "--color-tag-red", label: "red" },
  orange: { token: "--color-tag-orange", label: "orange" },
  brown: { token: "--color-tag-brown", label: "brown" },
  yellow: { token: "--color-tag-yellow", label: "yellow" },
  lightGreen: { token: "--color-tag-light-green", label: "light green" },
  darkGreen: { token: "--color-tag-green", label: "green" },
  lightBlue: { token: "--color-tag-light-blue", label: "light blue" },
  darkBlue: { token: "--color-tag-blue", label: "blue" },
  purple: { token: "--color-tag-purple", label: "purple" },
  magenta: { token: "--color-tag-pink", label: "pink" },
  lightGray: { token: "--color-tag-light-gray", label: "light gray" },
  charcoal: { token: "--color-tag-charcoal", label: "charcoal" },
};

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

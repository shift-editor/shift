/** Browser color scheme a theme paints with. */
export type ThemeAppearance = "light" | "dark";

/** Base16 slot names, in palette order. */
export const BASE16_KEYS = [
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
] as const;

export type Base16Key = (typeof BASE16_KEYS)[number];

/** A complete Base16 palette of six-digit `#rrggbb` colors. */
export type Base16Palette = { readonly [Key in Base16Key]: string };

/** A named color theme: metadata plus a complete Base16 palette. */
export interface ColorTheme {
  /** Stable identity; user themes are prefixed with {@link USER_THEME_PREFIX}. */
  readonly id: string;
  readonly name: string;
  readonly appearance: ThemeAppearance;
  readonly palette: Base16Palette;
}

/** Prefix that separates user theme ids from built-in ones. */
export const USER_THEME_PREFIX = "user:";

/** File extensions read as Base16 scheme files. */
export const THEME_FILE_EXTENSIONS = ["yaml", "yml", "json"] as const;

/** Outcome of asking main to import a theme file. */
export type ThemeImportResult =
  | { status: "imported"; theme: ColorTheme }
  | { status: "canceled" }
  | { status: "invalid" };

const HEX_COLOR = /^#?([0-9a-f]{6})$/i;
/** File-name stems safe to join onto the themes directory: no separators, no leading dot. */
const USER_THEME_SLUG = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$/;

/** Returns true when `id` names a user theme rather than a built-in one. */
export function isUserThemeId(id: string): boolean {
  return id.startsWith(USER_THEME_PREFIX);
}

/**
 * Returns the file-name slug of a user theme id.
 *
 * @returns the slug, or null when `id` is not a user id or is unsafe as a file name.
 */
export function userThemeSlug(id: string): string | null {
  if (!isUserThemeId(id)) return null;

  const slug = id.slice(USER_THEME_PREFIX.length);
  return USER_THEME_SLUG.test(slug) ? slug : null;
}

/** Turns a theme name into a file-name slug, falling back to `theme`. */
export function slugifyThemeName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "theme";
}

/**
 * Returns a slug derived from `name` that is not in `taken`.
 *
 * @param name - theme name to slugify.
 * @param taken - slugs already used by existing theme files.
 */
export function uniqueThemeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugifyThemeName(name);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

/**
 * Reads a Base16 scheme document into a theme.
 *
 * @remarks
 * Accepts the classic Base16 shape (`scheme`, `base00: "rrggbb"`, …) and the
 * Tinted Theming shape (`name`, `variant`, `palette: { base00: "#rrggbb" }`).
 * Colors are normalized to lowercase `#rrggbb`. A scheme without a `variant`
 * is dark when its background is darker than its foreground.
 *
 * @param document - parsed YAML or JSON value.
 * @param id - identity the resulting theme receives.
 * @returns the theme, or null when the document is not a complete Base16 scheme.
 */
export function parseBase16Scheme(document: unknown, id: string): ColorTheme | null {
  if (!isRecord(document)) return null;

  const source = isRecord(document.palette) ? document.palette : document;
  const palette: Partial<Record<Base16Key, string>> = {};
  for (const key of BASE16_KEYS) {
    const color = normalizeHexColor(source[key]);
    if (!color) return null;

    palette[key] = color;
  }

  const complete = palette as Base16Palette;
  const name = firstString(document.name, document.scheme)?.trim() || "Untitled Theme";
  const appearance = parseAppearance(document.variant) ?? inferAppearance(complete);
  return { id, name, appearance, palette: complete };
}

/**
 * Writes a theme as a Tinted Theming Base16 scheme document.
 *
 * @returns a plain object ready for YAML or JSON serialization.
 */
export function serializeBase16Scheme(theme: ColorTheme): Record<string, unknown> {
  return {
    system: "base16",
    name: theme.name,
    variant: theme.appearance,
    palette: { ...theme.palette },
  };
}

/**
 * Validates a theme received across a process boundary.
 *
 * @returns a normalized copy, or null when any field is missing or malformed.
 */
export function parseColorTheme(value: unknown): ColorTheme | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (!parseAppearance(value.appearance)) return null;

  return parseBase16Scheme(
    { name: value.name, variant: value.appearance, palette: value.palette },
    value.id,
  );
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = HEX_COLOR.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

function parseAppearance(value: unknown): ThemeAppearance | null {
  return value === "light" || value === "dark" ? value : null;
}

function inferAppearance(palette: Base16Palette): ThemeAppearance {
  return luminance(palette.base00) < luminance(palette.base05) ? "dark" : "light";
}

function luminance(color: string): number {
  const channel = (offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import {
  USER_THEME_PREFIX,
  uniqueThemeSlug,
  userThemeSlug,
  type Base16Key,
  type ColorTheme,
} from "@shared/themes";

/** What one Base16 slot paints in Shift, for the theme editor. */
export interface PaletteRole {
  readonly key: Base16Key;
  readonly label: string;
  readonly description: string;
}

/** A labelled run of palette slots shown together in the theme editor. */
export interface PaletteRoleGroup {
  readonly label: string;
  readonly roles: readonly PaletteRole[];
}

/** Base16 slots grouped by the Shift surfaces `applyResolvedTheme` derives from them. */
export const paletteRoleGroups: readonly PaletteRoleGroup[] = [
  {
    label: "Backgrounds",
    roles: [
      { key: "base00", label: "Background", description: "Canvas and point fill" },
      { key: "base01", label: "Surface", description: "Panels and inputs" },
      { key: "base02", label: "Chrome", description: "Toolbars on dark themes" },
      { key: "base03", label: "Muted", description: "Muted text and dark borders" },
    ],
  },
  {
    label: "Foregrounds",
    roles: [
      { key: "base04", label: "Secondary", description: "Secondary text and components" },
      { key: "base05", label: "Text", description: "Primary text" },
      { key: "base06", label: "Bright", description: "Glyphs on dark themes" },
      { key: "base07", label: "Brightest", description: "Glyphs on light themes" },
    ],
  },
  {
    label: "Accents",
    roles: [
      { key: "base08", label: "Red", description: "Errors and snapping" },
      { key: "base09", label: "Orange", description: "Debug outlines" },
      { key: "base0A", label: "Yellow", description: "Reserved" },
      { key: "base0B", label: "Green", description: "Component overlays" },
      { key: "base0C", label: "Cyan", description: "Canvas cyan" },
      { key: "base0D", label: "Accent", description: "Selection, handles, and focus" },
      { key: "base0E", label: "Purple", description: "Anchors" },
      { key: "base0F", label: "Magenta", description: "Component overlays" },
    ],
  },
];

/**
 * Copies `source` as a new, unsaved user theme with a name and id unused by `existing`.
 *
 * @param source - built-in or user theme to start from.
 * @param existing - current user themes, used to keep names and file ids distinct.
 */
export function duplicateTheme(source: ColorTheme, existing: readonly ColorTheme[]): ColorTheme {
  const names = new Set(existing.map((theme) => theme.name));
  let name = `${source.name} Copy`;
  for (let suffix = 2; names.has(name); suffix++) name = `${source.name} Copy ${suffix}`;

  return { ...source, id: newUserThemeId(name, existing), name };
}

/**
 * Returns a user theme id derived from `name` that no theme in `existing` uses.
 *
 * @remarks
 * The id names the theme's file, so a new theme takes it from the name it is
 * first saved under; later renames keep the id.
 */
export function newUserThemeId(name: string, existing: readonly ColorTheme[]): string {
  const slugs = new Set(existing.flatMap((theme) => userThemeSlug(theme.id) ?? []));
  return `${USER_THEME_PREFIX}${uniqueThemeSlug(name, slugs)}`;
}

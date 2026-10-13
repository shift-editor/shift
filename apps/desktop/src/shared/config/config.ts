import type { ConfigProblem, ThemeMode, ThemeSlots } from "@shift/types";

export type { ConfigProblem, ThemeMode, ThemeSlots };

/**
 * A theme id such as `nord`, or `system`, as written in `config.toml`.
 *
 * @remarks
 * Not a closed union: the file may name a theme this build does not have, and
 * Settings reports it rather than rejecting the file.
 */
export type ThemeName = string;

/**
 * The `theme` setting: a name (`theme = "nord"`), or a table choosing a mode
 * and the theme for each appearance (`theme = { mode = "system", light = "…", dark = "…" }`).
 *
 * @remarks
 * A table's missing keys are left to the renderer's defaults.
 */
export type ThemeSetting = ThemeName | ThemeSlots;

/**
 * Main-owned application settings read from this build's `config.toml`.
 *
 * @remarks
 * The file is the source of truth: Settings edits it, and an edit made in
 * another program applies to every window.
 */
export interface AppConfigState {
  /** This build's config folder, such as `~/.config/shift`. */
  directory: string;
  /** Whether `config.toml` exists; Shift creates it on the first change. */
  exists: boolean;
  /** The theme setting, or `null` when the file sets none. */
  theme: ThemeSetting | null;
  /** Problems with the current file; an error means `theme` is the last valid value. */
  problems: ConfigProblem[];
}

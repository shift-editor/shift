import type { ConfigProblem, ThemeFile, ThemeMode, ThemeSlots } from "@shift/types";

export type { ConfigProblem, ThemeFile, ThemeMode, ThemeSlots };

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

/** One theme file: Shift's bundled themes, or one in the config folder's `themes/`. */
export interface ThemeFileState {
  /** The file name without `.toml`; `config.toml` names it to choose it. */
  id: string;
  path: string;
  /**
   * The theme, or `null` when the file has never been valid; when a valid file
   * breaks, its last valid theme stays here beside the error.
   */
  theme: ThemeFile | null;
  problems: ConfigProblem[];
}

/** What main read from `config.toml` itself. */
export interface ConfigFileState {
  /** This build's config folder, such as `~/.config/shift`. */
  directory: string;
  /** Whether `config.toml` exists; Shift creates it on the first change. */
  exists: boolean;
  /** The theme setting, or `null` when the file sets none. */
  theme: ThemeSetting | null;
  /** Problems with the current file; an error means `theme` is the last valid value. */
  problems: ConfigProblem[];
}

/**
 * Main-owned application settings read from this build's `config.toml` and
 * `themes/` folder.
 *
 * @remarks
 * The files are the source of truth: Settings edits them, and an edit made in
 * another program applies to every window.
 */
export interface AppConfigState extends ConfigFileState {
  /** Theme files in `themes/`, ordered by id. */
  themes: ThemeFileState[];
  /** Read-only themes shipped with Shift, ordered by id; read once at startup. */
  bundledThemes: ThemeFileState[];
}

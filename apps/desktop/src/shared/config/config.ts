import type { ConfigProblem } from "@shift/types";

export type { ConfigProblem };

/**
 * A theme id such as `nord`, or `system`, as written in `config.toml`.
 *
 * @remarks
 * Not a closed union: the file may name a theme this build does not have, and
 * Settings reports it rather than rejecting the file.
 */
export type ThemeName = string;

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
  /** The selected theme id or `system`, or `null` when the file sets none. */
  theme: ThemeName | null;
  /** Problems with the current file; an error means `theme` is the last valid value. */
  problems: ConfigProblem[];
}

/** One problem found in `config.toml`, as shown in Settings → Appearance. */
export interface ConfigProblem {
  /**
   * `error` means the file was not applied and Shift kept the last valid
   * settings; `warning` means the file applied but a key was ignored.
   */
  severity: "error" | "warning";
  message: string;
  /** One-based line in `config.toml`, when the problem has a location. */
  line: number | null;
  /** One-based column in `config.toml`, when the problem has a location. */
  column: number | null;
}

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
  theme: string | null;
  /** Problems with the current file; an error means `theme` is the last valid value. */
  problems: ConfigProblem[];
}

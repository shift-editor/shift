import type { ConfigProblem } from "@shift/types";
import { configRead, configSetTheme } from "shift-bridge";
import type { ThemeName } from "../../shared/config/config";

/** Settings this build reads from `config.toml`. */
export interface ConfigValues {
  /** A theme id or `system`; `null` when the file does not choose one. */
  theme: ThemeName | null;
}

/**
 * The result of reading `config.toml`: its values, or `null` values when an
 * error means the file must not be applied.
 */
export interface ConfigRead {
  values: ConfigValues | null;
  problems: ConfigProblem[];
}

/**
 * Reads the settings in a `config.toml` source.
 *
 * @remarks
 * Parsing and validation live in the `shift-config` crate, shared with
 * `shift-cli`, so the app and the command agree on what a valid file is.
 */
export function readConfig(source: string): ConfigRead {
  const read = configRead(source);
  return {
    values: read.valid ? { theme: read.theme ?? null } : null,
    problems: read.problems,
  };
}

/**
 * Returns `source` with its theme set to `theme`, preserving every comment,
 * key, and blank line it does not change.
 *
 * @param source - the current file, or `null` when it does not exist yet.
 * @throws Error when `source` has errors, so an edit never overwrites a file
 * the user is still fixing.
 */
export function setConfigTheme(source: string | null, theme: ThemeName): string {
  return configSetTheme(source, theme);
}

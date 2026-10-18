import path from "node:path";

export interface ConfigDirectoryInput {
  platform: NodeJS.Platform;
  /** This build's short name, such as `shift` or `shift-nightly`. */
  buildName: string;
  homeDirectory: string;
  /** This build's user data directory. */
  userDataDirectory: string;
  /** Whether `--user-data-dir` was passed, as tests and diagnostics do. */
  explicitUserDataDirectory: boolean;
  /** `XDG_CONFIG_HOME`, when set. */
  xdgConfigHome: string | undefined;
}

/**
 * Returns the folder holding this build's `config.toml` and themes.
 *
 * @remarks
 * macOS and Linux use the XDG location, `~/.config/<build>`, so the folder can
 * live in a dotfiles repository; each build has its own. Windows keeps it in
 * user data, beside the app's other files. An explicit `--user-data-dir` moves
 * it into that directory, so a test or diagnostic run never reads or writes the
 * user's real config.
 */
export function configDirectory(input: ConfigDirectoryInput): string {
  if (input.explicitUserDataDirectory || input.platform === "win32") {
    return path.join(input.userDataDirectory, "config");
  }

  const xdgConfigHome = input.xdgConfigHome?.trim();
  // The XDG specification ignores a relative XDG_CONFIG_HOME.
  const base =
    xdgConfigHome && path.isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : path.join(input.homeDirectory, ".config");
  return path.join(base, input.buildName);
}

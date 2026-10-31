import type { AppConfigState } from "@shared/config/config";
import {
  bundledColorThemes,
  colorThemes,
  themeById,
  userColorThemes,
  type ColorTheme,
} from "./index";

/**
 * The themes a window can choose from, in list order: Shift's built-in
 * themes, the bundled theme files, then the user's theme files.
 *
 * @remarks
 * Builds the combined list once, so callers ask the catalog instead of
 * spreading the three sources together at each use.
 */
export class ThemeCatalog {
  /** Shift's built-in themes only, before main has sent its state. */
  static readonly BUILT_IN = new ThemeCatalog(colorThemes, []);

  /** Every theme Shift ships and the valid user files, as main reports them. */
  static of(state: AppConfigState): ThemeCatalog {
    const shipped = ThemeCatalog.shipped(state);
    return new ThemeCatalog(shipped, userColorThemes(state.themes, shipped).themes);
  }

  /** The themes Shift ships: built into the app, then bundled as files. */
  static shipped(state: AppConfigState): readonly ColorTheme[] {
    return [...colorThemes, ...bundledColorThemes(state.bundledThemes)];
  }

  /** Every theme, shipped first. */
  readonly all: readonly ColorTheme[];

  /**
   * @param shipped - Built-in then bundled themes.
   * @param user - Themes from the user's files, after `shipped`.
   */
  constructor(
    readonly shipped: readonly ColorTheme[],
    readonly user: readonly ColorTheme[],
  ) {
    this.all = [...shipped, ...user];
  }

  /** The same shipped themes with `user` as the user's themes. */
  withUser(user: readonly ColorTheme[]): ThemeCatalog {
    return new ThemeCatalog(this.shipped, user);
  }

  has(id: string): boolean {
    return this.all.some((theme) => theme.id === id);
  }

  /** The theme with `id`, or Shift Light for an id the catalog does not have. */
  byId(id: string): ColorTheme {
    return themeById(id, this.all);
  }
}

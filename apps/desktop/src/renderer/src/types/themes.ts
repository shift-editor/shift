import type { ColorTheme } from "@shared/themes";

/**
 * Where `ThemeProvider` reads the user's themes from.
 *
 * @remarks
 * The desktop app passes the Shift host's themes API. Surfaces without a host,
 * such as the browser editor, omit it and offer built-in themes only.
 */
export interface UserThemeSource {
  list: () => Promise<ColorTheme[]>;
  /** @returns an unsubscribe function. */
  onChanged: (callback: (themes: ColorTheme[]) => void) => () => void;
}

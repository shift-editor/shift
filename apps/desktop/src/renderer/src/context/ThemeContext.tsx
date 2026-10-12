import { createContext, useContext } from "react";

import type { AppConfigState } from "@shared/config/config";
import type { ColorTheme, ThemeSelection } from "@/lib/themes";
export type { ColorTheme, ThemeAppearance, ThemeId, ThemeSelection } from "@/lib/themes";

export interface ThemeContextValue {
  themeSelection: ThemeSelection;
  resolvedTheme: ColorTheme;
  /** Writes the selection to `config.toml`; a refused write restores the previous selection. */
  setThemeSelection: (selection: ThemeSelection) => void;
  /** This build's config, or `null` until main has answered. */
  config: AppConfigState | null;
  /** A theme named in `config.toml` that Shift does not have, or `null`. */
  unknownTheme: string | null;
  /** Why the last change from Settings was not saved, or `null`. */
  saveError: string | null;
}

/**
 * The theme context, kept free of the desktop host so browser builds of the
 * canvas can read the theme; `ThemeProvider` supplies it.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

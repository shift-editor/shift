import { createContext, useContext } from "react";

import type { AppConfigState, UserThemeFile } from "@shared/config/config";
import type {
  ColorTheme,
  ThemeAppearance,
  ThemePreference,
  UnknownThemeColors,
} from "@/lib/themes";
export type {
  ColorTheme,
  ThemeAppearance,
  ThemeId,
  ThemeMode,
  ThemePreference,
} from "@/lib/themes";

export interface ThemeContextValue {
  /** The mode and the light and dark themes from `config.toml`. */
  preference: ThemePreference;
  /** The theme on screen: the previewed theme while one is set, otherwise the preference's. */
  resolvedTheme: ColorTheme;
  /** Shows `theme` everywhere, canvas included, without saving it; `null` ends the preview. */
  previewTheme: (themeId: string | null) => void;
  /** The OS appearance, which picks the theme in `system` mode. */
  systemAppearance: ThemeAppearance;
  /** Built-in themes followed by the valid files in `themes/`, ordered by id. */
  themes: readonly ColorTheme[];
  /** Theme files ignored because they reuse a built-in theme's id or `system`. */
  shadowingThemeFiles: readonly UserThemeFile[];
  /** Writes the preference to `config.toml`; a refused write restores the previous one. */
  setPreference: (preference: ThemePreference) => void;
  /** Override names in theme files that name no color Shift has. */
  unknownThemeColors: readonly UnknownThemeColors[];
  /** This build's config, or `null` until main has answered. */
  config: AppConfigState | null;
  /** Theme names in `config.toml` that Shift does not have; each uses its default. */
  unknownThemes: string[];
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

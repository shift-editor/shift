import { useCallback, useEffect, useInsertionEffect, useState, type ReactNode } from "react";

import type { AppConfigState } from "@shared/config/config";
import { getShiftHost } from "@/host/shiftHost";
import {
  applyResolvedTheme,
  colorThemes,
  defaultThemePreference,
  readThemeSetting,
  resolveTheme,
  themeById,
  writeThemeSetting,
  type ThemeAppearance,
  type ThemeId,
  type ThemeMode,
  type ThemePreference,
} from "@/lib/themes";
import { ThemeContext } from "./ThemeContext";

/** This window's copy of the last applied preference, read before main answers so the first paint is right. */
const THEME_CACHE_KEY = "themeCache";

function getSystemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

function readCachedPreference(): ThemePreference | null {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(THEME_CACHE_KEY) ?? "null");
    if (typeof cached !== "object" || cached === null) return null;
    const { mode, light, dark } = cached as Record<string, unknown>;
    const isKnown = (id: unknown): id is ThemeId => colorThemes.some((theme) => theme.id === id);
    if (THEME_MODES.includes(mode as ThemeMode) && isKnown(light) && isKnown(dark)) {
      return { mode: mode as ThemeMode, light, dark };
    }
  } catch {
    // An unreadable cache only costs the first paint.
  }
  return null;
}

function cachePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(preference));
  } catch {
    // The cache only speeds up the first paint; config.toml stays authoritative.
  }
}

/**
 * Applies the theme chosen in `config.toml` to this window.
 *
 * @remarks
 * Main owns the file and notifies every window when it changes, whether the
 * change came from Settings or another program.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => readCachedPreference() ?? defaultThemePreference,
  );
  const [config, setConfig] = useState<AppConfigState | null>(null);
  const [unknownThemes, setUnknownThemes] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [systemAppearance, setSystemAppearance] = useState<ThemeAppearance>(getSystemAppearance);
  const [previewId, previewTheme] = useState<ThemeId | null>(null);
  const resolvedTheme = previewId
    ? themeById(previewId)
    : resolveTheme(preference, systemAppearance);

  const applyConfig = useCallback((state: AppConfigState) => {
    const read = readThemeSetting(state.theme);
    setConfig(state);
    setPreferenceState(read.preference);
    setUnknownThemes(read.unknownThemes);
  }, []);

  const setPreference = useCallback(
    async (next: ThemePreference) => {
      const previous = preference;
      setPreferenceState(next);
      setSaveError(null);
      try {
        const setting = writeThemeSetting(next, config?.theme ?? null);
        applyConfig(await getShiftHost().config.setTheme(setting));
      } catch (error) {
        setPreferenceState(previous);
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyConfig, config, preference],
  );

  useInsertionEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    cachePreference(preference);
  }, [preference]);

  useEffect(() => {
    const host = getShiftHost().config;
    let active = true;
    const unsubscribe = host.onChanged((state) => {
      if (active) applyConfig(state);
    });

    const load = async () => {
      try {
        const state = await host.state();
        if (active) applyConfig(state);
      } catch (error) {
        console.error("Cannot read config.toml", error);
      }
    };
    void load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyConfig]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemAppearance(mediaQuery.matches ? "dark" : "light");

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        preference,
        resolvedTheme,
        previewTheme,
        systemAppearance,
        setPreference: (next) => void setPreference(next),
        config,
        unknownThemes,
        saveError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

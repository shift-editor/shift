import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AppConfigState } from "@shared/config/config";
import { getShiftHost } from "@/host/shiftHost";
import {
  applyResolvedTheme,
  colorThemes,
  defaultThemePreference,
  readThemeSetting,
  resolveTheme,
  themeById,
  userColorThemes,
  writeThemeSetting,
  type ColorTheme,
  type ThemeAppearance,
  type ThemeMode,
  type ThemePreference,
} from "@/lib/themes";
import { ThemeContext } from "./ThemeContext";

/**
 * This window's copy of the last applied preference, with the user themes its
 * slots name, read before main answers so the first paint is right.
 */
const THEME_CACHE_KEY = "themeCache";

interface ThemeCache {
  preference: ThemePreference;
  /** User themes the preference names, which only main can otherwise supply. */
  userThemes: ColorTheme[];
}

function getSystemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

function readThemeCache(): ThemeCache | null {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(THEME_CACHE_KEY) ?? "null");
    if (typeof cached !== "object" || cached === null) return null;
    const { preference, userThemes } = cached as Partial<ThemeCache>;
    const themes = [...colorThemes, ...(Array.isArray(userThemes) ? userThemes : [])];
    const isKnown = (id: unknown) => themes.some((theme) => theme.id === id);
    if (
      preference &&
      THEME_MODES.includes(preference.mode) &&
      isKnown(preference.light) &&
      isKnown(preference.dark)
    ) {
      return { preference, userThemes: themes.slice(colorThemes.length) };
    }
  } catch {
    // An unreadable cache only costs the first paint.
  }
  return null;
}

function writeThemeCache(cache: ThemeCache): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // The cache only speeds up the first paint; config.toml stays authoritative.
  }
}

/** Built-in themes followed by the valid files in `themes/`. */
function availableThemes(state: AppConfigState): ColorTheme[] {
  return [...colorThemes, ...userColorThemes(state.themes).themes];
}

/**
 * Applies the theme chosen in `config.toml`, from the built-in themes and the
 * files in `themes/`, to this window.
 *
 * @remarks
 * Main owns the files and notifies every window when one changes, whether the
 * change came from Settings or another program. An edited theme file arrives
 * as a new `ColorTheme` object, which is what tells the canvas and GPU layers
 * to redraw.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [initialCache] = useState(readThemeCache);
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialCache?.preference ?? defaultThemePreference,
  );
  const [config, setConfig] = useState<AppConfigState | null>(null);
  // The latest state main sent, for writes that follow another write before React re-renders.
  const configRef = useRef<AppConfigState | null>(null);
  const [unknownThemes, setUnknownThemes] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [systemAppearance, setSystemAppearance] = useState<ThemeAppearance>(getSystemAppearance);
  const [previewId, previewTheme] = useState<string | null>(null);

  const { themes: userThemes, shadowing: shadowingThemeFiles } = useMemo(
    () => userColorThemes(config?.themes ?? []),
    [config],
  );
  const themes = useMemo(
    // Until main answers, the cached user themes stand in for their files.
    () => [...colorThemes, ...(config ? userThemes : (initialCache?.userThemes ?? []))],
    [config, initialCache, userThemes],
  );
  const resolvedTheme = useMemo(
    () =>
      previewId ? themeById(previewId, themes) : resolveTheme(preference, systemAppearance, themes),
    [preference, previewId, systemAppearance, themes],
  );

  const applyConfig = useCallback((state: AppConfigState) => {
    const read = readThemeSetting(state.theme, availableThemes(state));
    configRef.current = state;
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
        const current = configRef.current;
        const themes = current ? availableThemes(current) : colorThemes;
        const setting = writeThemeSetting(next, current?.theme ?? null, themes);
        applyConfig(await getShiftHost().config.setTheme(setting));
      } catch (error) {
        setPreferenceState(previous);
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyConfig, preference],
  );

  useInsertionEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const named = new Set([preference.light, preference.dark]);
    writeThemeCache({
      preference,
      userThemes: themes.filter((theme) => theme.file && named.has(theme.id)),
    });
  }, [preference, themes]);

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
        themes,
        shadowingThemeFiles,
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

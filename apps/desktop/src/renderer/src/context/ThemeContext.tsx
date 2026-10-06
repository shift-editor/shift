import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { parseColorTheme } from "@shared/themes";
import {
  applyResolvedTheme,
  colorThemes,
  defaultThemePreferences,
  resolveThemeSelection,
  type ColorTheme,
  type ThemeAppearance,
  type ThemeId,
  type ThemePreferences,
  type ThemeSelection,
} from "@/lib/themes";
import type { UserThemeSource } from "@/types/themes";
export type {
  ColorTheme,
  ThemeAppearance,
  ThemeId,
  ThemePreferences,
  ThemeSelection,
} from "@/lib/themes";

export interface ThemeContextValue {
  preferences: ThemePreferences;
  /** Built-in themes followed by the user's themes. */
  themes: readonly ColorTheme[];
  userThemes: readonly ColorTheme[];
  /** The theme currently painting the app, including an unsaved preview. */
  resolvedTheme: ColorTheme;
  setThemeSelection: (selection: ThemeSelection) => void;
  /** Sets the theme `system` uses for one OS appearance. */
  setSystemTheme: (appearance: ThemeAppearance, id: ThemeId) => void;
  /** Paints `theme` without persisting it, or restores the preferences with null. */
  setPreviewTheme: (theme: ColorTheme | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** localStorage keys; `themeSelection` predates user themes and keeps its name. */
const PREFERENCE_KEYS = {
  selection: "themeSelection",
  light: "themeLight",
  dark: "themeDark",
} as const satisfies Record<keyof ThemePreferences, string>;

/** Last user theme list, so a selected user theme paints on first frame before main replies. */
const USER_THEMES_CACHE_KEY = "userThemes";

function getSystemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readPreferences(defaultSelection: ThemeSelection): ThemePreferences {
  const read = (key: keyof ThemePreferences, fallback: string) => {
    try {
      return localStorage.getItem(PREFERENCE_KEYS[key]) || fallback;
    } catch {
      return fallback;
    }
  };

  return {
    selection: read("selection", defaultSelection),
    light: read("light", defaultThemePreferences.light),
    dark: read("dark", defaultThemePreferences.dark),
  };
}

function writePreference(key: keyof ThemePreferences, value: string): void {
  try {
    localStorage.setItem(PREFERENCE_KEYS[key], value);
  } catch (error) {
    console.error("saving theme preference failed", error);
  }
}

function readCachedUserThemes(): ColorTheme[] {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(USER_THEMES_CACHE_KEY) ?? "[]");
    if (!Array.isArray(cached)) return [];

    return cached.flatMap((value) => {
      const theme = parseColorTheme(value);
      return theme ? [theme] : [];
    });
  } catch {
    return [];
  }
}

function cacheUserThemes(themes: readonly ColorTheme[]): void {
  try {
    localStorage.setItem(USER_THEMES_CACHE_KEY, JSON.stringify(themes));
  } catch (error) {
    console.error("caching user themes failed", error);
  }
}

function preferenceKeyFor(storageKey: string | null): keyof ThemePreferences | null {
  switch (storageKey) {
    case PREFERENCE_KEYS.selection:
      return "selection";
    case PREFERENCE_KEYS.light:
      return "light";
    case PREFERENCE_KEYS.dark:
      return "dark";
    default:
      return null;
  }
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeSelection;
  /** Supplies user themes; without it only built-in themes are offered. */
  userThemeSource?: UserThemeSource;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export function ThemeProvider({
  children,
  defaultTheme = "shift-light",
  userThemeSource,
}: ThemeProviderProps) {
  const [preferences, setPreferences] = useState(() => readPreferences(defaultTheme));
  const [userThemes, setUserThemesState] = useState(readCachedUserThemes);
  const [previewTheme, setPreviewTheme] = useState<ColorTheme | null>(null);
  const [systemAppearance, setSystemAppearance] = useState<ThemeAppearance>(getSystemAppearance);

  const themes = useMemo(() => [...colorThemes, ...userThemes], [userThemes]);
  const persistedTheme = useMemo(
    () => resolveThemeSelection(preferences, systemAppearance, themes),
    [preferences, systemAppearance, themes],
  );
  const resolvedTheme = previewTheme ?? persistedTheme;

  const setUserThemes = useCallback((next: readonly ColorTheme[]) => {
    setUserThemesState([...next]);
    cacheUserThemes(next);
  }, []);

  const setPreference = useCallback((key: keyof ThemePreferences, value: string) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    writePreference(key, value);
  }, []);

  const setThemeSelection = useCallback(
    (selection: ThemeSelection) => setPreference("selection", selection),
    [setPreference],
  );

  const setSystemTheme = useCallback(
    (appearance: ThemeAppearance, id: ThemeId) => setPreference(appearance, id),
    [setPreference],
  );

  useInsertionEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!userThemeSource) return;

    let active = true;
    const unsubscribe = userThemeSource.onChanged(setUserThemes);

    const load = async () => {
      try {
        const listed = await userThemeSource.list();
        if (active) setUserThemes(listed);
      } catch (error) {
        console.error("loading user themes failed", error);
      }
    };
    void load();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [userThemeSource, setUserThemes]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemAppearance(mediaQuery.matches ? "dark" : "light");

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      const key = preferenceKeyFor(event.key);
      if (!key || !event.newValue) return;

      const value = event.newValue;
      setPreferences((current) => ({ ...current, [key]: value }));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({
      preferences,
      themes,
      userThemes,
      resolvedTheme,
      setThemeSelection,
      setSystemTheme,
      setPreviewTheme,
    }),
    [preferences, themes, userThemes, resolvedTheme, setThemeSelection, setSystemTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

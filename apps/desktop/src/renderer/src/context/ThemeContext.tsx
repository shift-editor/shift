import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useState,
  type ReactNode,
} from "react";

import type { AppConfigState } from "@shared/config/config";
import { getShiftHost } from "@/host/shiftHost";
import {
  applyResolvedTheme,
  isThemeSelection,
  resolveThemeSelection,
  type ColorTheme,
  type ThemeAppearance,
  type ThemeSelection,
} from "@/lib/themes";
export type { ColorTheme, ThemeAppearance, ThemeId, ThemeSelection } from "@/lib/themes";

/** This window's copy of the last applied selection, read before main answers so the first paint is right. */
const THEME_CACHE_KEY = "themeCache";
/** Where Shift kept the selection before `config.toml`; migrated once, then removed. */
const LEGACY_THEME_KEY = "themeSelection";

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

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readStoredSelection(key: string): ThemeSelection | null {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(key);
  return stored !== null && isThemeSelection(stored) ? stored : null;
}

function cacheSelection(selection: ThemeSelection): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, selection);
  } catch {
    // The cache only speeds up the first paint; config.toml stays authoritative.
  }
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeSelection;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

/**
 * Applies the theme selected in `config.toml` to this window.
 *
 * @remarks
 * Main owns the file and notifies every window when it changes, whether the
 * change came from Settings or another program.
 */
export function ThemeProvider({ children, defaultTheme = "shift-light" }: ThemeProviderProps) {
  const [themeSelection, setThemeSelectionState] = useState<ThemeSelection>(
    () =>
      readStoredSelection(THEME_CACHE_KEY) ?? readStoredSelection(LEGACY_THEME_KEY) ?? defaultTheme,
  );
  const [config, setConfig] = useState<AppConfigState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [systemAppearance, setSystemAppearance] = useState<ThemeAppearance>(getSystemAppearance);
  const resolvedTheme = resolveThemeSelection(themeSelection, systemAppearance);
  const unknownTheme = config?.theme && !isThemeSelection(config.theme) ? config.theme : null;

  const applyConfig = useCallback(
    (state: AppConfigState) => {
      setConfig(state);
      const selection = state.theme !== null && isThemeSelection(state.theme) ? state.theme : null;
      setThemeSelectionState(selection ?? defaultTheme);
    },
    [defaultTheme],
  );

  const setThemeSelection = useCallback(
    async (selection: ThemeSelection) => {
      const previous = themeSelection;
      setThemeSelectionState(selection);
      setSaveError(null);
      try {
        applyConfig(await getShiftHost().config.setTheme(selection));
      } catch (error) {
        setThemeSelectionState(previous);
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    },
    [applyConfig, themeSelection],
  );

  useInsertionEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    cacheSelection(themeSelection);
  }, [themeSelection]);

  useEffect(() => {
    const host = getShiftHost().config;
    let active = true;
    const unsubscribe = host.onChanged((state) => {
      if (active) applyConfig(state);
    });

    const load = async () => {
      try {
        let state = await host.state();
        const legacy = readStoredSelection(LEGACY_THEME_KEY);
        const fileIsValid = !state.problems.some(({ severity }) => severity === "error");
        if (legacy !== null && state.theme === null && fileIsValid) {
          state = await host.setTheme(legacy);
        }
        localStorage.removeItem(LEGACY_THEME_KEY);
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
        themeSelection,
        resolvedTheme,
        setThemeSelection: (selection) => void setThemeSelection(selection),
        config,
        unknownTheme,
        saveError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

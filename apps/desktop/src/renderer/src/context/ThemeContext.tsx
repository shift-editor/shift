import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useState,
  type ReactNode,
} from "react";

import {
  applyResolvedTheme,
  colorThemes,
  resolveThemeSelection,
  type ColorTheme,
  type ThemeAppearance,
  type ThemeSelection,
} from "@/lib/themes";
export type { ColorTheme, ThemeAppearance, ThemeId, ThemeSelection } from "@/lib/themes";

export interface ThemeContextValue {
  themeSelection: ThemeSelection;
  resolvedTheme: ColorTheme;
  setThemeSelection: (selection: ThemeSelection) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
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

export function ThemeProvider({ children, defaultTheme = "shift-light" }: ThemeProviderProps) {
  const [themeSelection, setThemeSelectionState] = useState<ThemeSelection>(() => {
    if (typeof localStorage === "undefined") return defaultTheme;
    const stored = localStorage.getItem("themeSelection");
    if (stored === "system" || colorThemes.some((theme) => theme.id === stored)) {
      return stored as ThemeSelection;
    }
    return defaultTheme;
  });
  const [systemAppearance, setSystemAppearance] = useState<ThemeAppearance>(getSystemAppearance);
  const resolvedTheme = resolveThemeSelection(themeSelection, systemAppearance);

  const setThemeSelection = useCallback((selection: ThemeSelection) => {
    setThemeSelectionState(selection);
    localStorage.setItem("themeSelection", selection);
  }, []);

  useInsertionEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemAppearance(mediaQuery.matches ? "dark" : "light");

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "themeSelection" || !event.newValue) return;
      if (event.newValue === "system" || colorThemes.some((theme) => theme.id === event.newValue)) {
        setThemeSelectionState(event.newValue as ThemeSelection);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ themeSelection, resolvedTheme, setThemeSelection }}>
      {children}
    </ThemeContext.Provider>
  );
}

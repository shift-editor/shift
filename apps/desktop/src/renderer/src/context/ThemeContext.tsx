import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { ThemeTokens, lightTheme, applyThemeToCss } from "@/lib/styles/theme";

export type ThemeName = "light" | "dark" | "system";

interface ThemeContextValue {
  themeName: ThemeName;
  theme: ThemeTokens;
  setThemeName: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const themes: Record<Exclude<ThemeName, "system">, ThemeTokens> = {
  light: lightTheme,
  dark: lightTheme, // TODO: Replace with darkTheme when implemented
};

function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

function resolveTheme(themeName: ThemeName): ThemeTokens {
  if (themeName === "system") {
    return themes[getSystemTheme()];
  }
  return themes[themeName];
}

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeName;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: ThemeProviderProps) {
  const [themeName, setThemeName] = useState<ThemeName>(defaultTheme);
  const [theme, setTheme] = useState<ThemeTokens>(() =>
    resolveTheme(defaultTheme),
  );

  useEffect(() => {
    const resolved = resolveTheme(themeName);
    setTheme(resolved);
    applyThemeToCss(resolved);
  }, [themeName]);

  useEffect(() => {
    if (themeName !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const resolved = resolveTheme("system");
      setTheme(resolved);
      applyThemeToCss(resolved);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [themeName]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSetTheme((newTheme) => {
      setThemeName(newTheme);
    });

    window.electronAPI?.getTheme().then((savedTheme) => {
      if (savedTheme) {
        setThemeName(savedTheme);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ themeName, theme, setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

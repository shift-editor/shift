import { ThemeTokens } from "./tokens";

export function applyThemeToCss(theme: ThemeTokens): void {
  const root = document.documentElement;

  root.style.setProperty("--color-bg-app", theme.ui.bg.app);
  root.style.setProperty("--color-bg-canvas", theme.ui.bg.canvas);
  root.style.setProperty("--color-bg-toolbar", theme.ui.bg.toolbar);
  root.style.setProperty("--color-bg-toolbar-hover", theme.ui.bg.toolbarHover);
  root.style.setProperty("--color-bg-surface", theme.ui.bg.surface);
  root.style.setProperty("--color-bg-surface-hover", theme.ui.bg.surfaceHover);

  root.style.setProperty("--color-line", theme.ui.border.default);
  root.style.setProperty("--color-line-subtle", theme.ui.border.subtle);

  root.style.setProperty("--color-text-primary", theme.ui.text.primary);
  root.style.setProperty("--color-text-secondary", theme.ui.text.secondary);
  root.style.setProperty("--color-text-muted", theme.ui.text.muted);

  root.style.setProperty("--color-canvas-purple", theme.canvas.purple);
  root.style.setProperty("--color-canvas-orange", theme.canvas.orange);
  root.style.setProperty("--color-canvas-green", theme.canvas.green);
  root.style.setProperty("--color-canvas-indigo", theme.canvas.indigo);
  root.style.setProperty("--color-canvas-blue", theme.canvas.blue);
  root.style.setProperty("--color-canvas-cyan", theme.canvas.cyan);
  root.style.setProperty("--color-canvas-gray", theme.canvas.gray);
}

export function getThemeFromCss(): Partial<ThemeTokens> {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  return {
    ui: {
      bg: {
        app: style.getPropertyValue("--color-bg-app").trim(),
        canvas: style.getPropertyValue("--color-bg-canvas").trim(),
        toolbar: style.getPropertyValue("--color-bg-toolbar").trim(),
        toolbarHover: style.getPropertyValue("--color-bg-toolbar-hover").trim(),
        surface: style.getPropertyValue("--color-bg-surface").trim(),
        surfaceHover: style.getPropertyValue("--color-bg-surface-hover").trim(),
      },
      border: {
        default: style.getPropertyValue("--color-line").trim(),
        subtle: style.getPropertyValue("--color-line-subtle").trim(),
      },
      text: {
        primary: style.getPropertyValue("--color-text-primary").trim(),
        secondary: style.getPropertyValue("--color-text-secondary").trim(),
        muted: style.getPropertyValue("--color-text-muted").trim(),
      },
    },
    canvas: {
      white: style.getPropertyValue("--color-canvas-white").trim(),
      black: style.getPropertyValue("--color-canvas-black").trim(),
      pink: style.getPropertyValue("--color-canvas-pink").trim(),
      indicator: style.getPropertyValue("--color-canvas-indicator").trim(),
      purple: style.getPropertyValue("--color-canvas-purple").trim(),
      orange: style.getPropertyValue("--color-canvas-orange").trim(),
      green: style.getPropertyValue("--color-canvas-green").trim(),
      indigo: style.getPropertyValue("--color-canvas-indigo").trim(),
      blue: style.getPropertyValue("--color-canvas-blue").trim(),
      cyan: style.getPropertyValue("--color-canvas-cyan").trim(),
      gray: style.getPropertyValue("--color-canvas-gray").trim(),
    },
  };
}

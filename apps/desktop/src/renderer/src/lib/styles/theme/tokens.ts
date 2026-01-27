export interface UIColors {
  bg: {
    app: string;
    canvas: string;
    toolbar: string;
    toolbarHover: string;
    surface: string;
    surfaceHover: string;
  };
  border: {
    default: string;
    subtle: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
  };
}

export interface CanvasAccentColors {
  black: string;
  pink: string;
  indicator: string;
  purple: string;
  orange: string;
  green: string;
  indigo: string;
  blue: string;
  cyan: string;
  gray: string;
}

export interface ThemeTokens {
  name: "light" | "dark";
  ui: UIColors;
  canvas: CanvasAccentColors;
}

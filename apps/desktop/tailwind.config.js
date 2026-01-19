/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--color-bg-app)",
        canvas: "var(--color-bg-canvas)",
        toolbar: "var(--color-bg-toolbar)",
        "toolbar-hover": "var(--color-bg-toolbar-hover)",
        surface: "var(--color-bg-surface)",
        "surface-hover": "var(--color-bg-surface-hover)",
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        muted: "var(--color-text-muted)",
        "canvas-purple": "var(--color-canvas-purple)",
        "canvas-orange": "var(--color-canvas-orange)",
        "canvas-green": "var(--color-canvas-green)",
        "canvas-indigo": "var(--color-canvas-indigo)",
        "canvas-blue": "var(--color-canvas-blue)",
        "canvas-cyan": "var(--color-canvas-cyan)",
      },
      borderColor: {
        DEFAULT: "var(--color-border-default)",
        subtle: "var(--color-border-subtle)",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "var(--color-bg-app)",
          canvas: "var(--color-bg-canvas)",
          toolbar: "var(--color-bg-toolbar)",
          "toolbar-hover": "var(--color-bg-toolbar-hover)",
          surface: "var(--color-bg-surface)",
          "surface-hover": "var(--color-bg-surface-hover)",
        },
        border: {
          DEFAULT: "var(--color-border-default)",
          subtle: "var(--color-border-subtle)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        canvas: {
          purple: "var(--color-canvas-purple)",
          orange: "var(--color-canvas-orange)",
          green: "var(--color-canvas-green)",
          indigo: "var(--color-canvas-indigo)",
          blue: "var(--color-canvas-blue)",
          cyan: "var(--color-canvas-cyan)",
        },
      },
    },
  },
  plugins: [],
};

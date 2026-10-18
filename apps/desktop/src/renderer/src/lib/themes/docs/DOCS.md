# Color Themes

<!-- reviewed: 2026-10-11 review-every: 90d -->

Terminal-style color themes for the desktop UI and native editor renderers.

## Architecture Invariants

- A `ColorTheme` is a complete 16-color semantic source palette with a stable id and `ThemeAppearance`. Built-in themes use a `ThemeId`; user themes come from `themes/<id>.toml` in the config folder and use the file name as their id.
- A theme file's optional `[colors]` table overrides individual derived colors by name: the CSS variable without its `--color-` or `--` prefix (`accent`, `editor-handle-primary-stroke`). `applyResolvedTheme` applies overrides after the palette mapping; `COLOR_VARIABLES` maps every name to its variable, and unknown names are ignored and reported.
- Shift ships themes two ways: the built-in `colorThemes` in code (Shift's own and the classics), and read-only bundled theme files in `apps/desktop/themes/`, converted from Tinted Theming's base16 schemes and packaged as `Resources/themes/`. Main reads the bundled files once at startup through the same parser as user files. Both kinds are listed together in the pickers, Shift's own first, then by name.
- A user theme file named like a built-in or bundled theme, or `system`, is ignored and reported, so `theme = "nord"` always means the built-in Nord. Bundled ids are upstream scheme slugs (`catppuccin-mocha`), which people write into their dotfiles; never rename one.
- Light palettes map their glyph to whichever of `base05`–`base07` contrasts most with the canvas, and darken `base04` toward `base05` until secondary text and control handles reach 3:1. Base16 light schemes often put an accent or a pale tint in `base07` and a faint grey in `base04`. Every built-in theme maps exactly as before.
- `bundledThemes.test.ts` checks every built-in and bundled theme for readable glyphs, text, points, handles, anchors, snapping, and text on the accent. A bundled theme that falls short gets the smallest `[colors]` override that passes, with its color darkened toward the theme's own text color; Solarized's text on the accent is a known exception.
- An edited theme file arrives as a new `ColorTheme` object. Every renderer keys its redraw on `resolvedTheme` identity, so a palette change under the same id repaints the DOM, Canvas 2D, WebGL markers, and Slug without a separate signal.
- `ThemePreference` is a mode (`system`, `light`, or `dark`) plus a theme for each appearance. `system` picks the light or dark slot from `prefers-color-scheme`; the slots default to Shift Light and Shift Dark.
- `applyResolvedTheme` maps one resolved palette into both Tailwind's `--color-*` variables and the editor's `--editor-*` variables. DOM, Canvas 2D, WebGL markers, and Slug must therefore redraw from the same resolved theme.
- Shared UI components consume semantic utilities and never import this registry or depend on theme ids.
- Renderer geometry remains in `EditorRenderTheme`; color themes change appearance, not handle dimensions or hit geometry.
- Shift Light is the no-JavaScript fallback in `index.css`. Selecting it removes runtime variable overrides rather than duplicating the fallback declarations.
- The preference is application-wide and lives in the build's `config.toml`, owned by main's `AppConfig`. It is not font or document data. `theme = "nord"` means Nord in its own appearance; `theme = { mode = "system", light = "…", dark = "…" }` (or a `[theme]` table) sets the mode and both slots. Settings writes the file; an edit from another program applies to every window. Each window caches its last applied preference in `localStorage` (`themeCache`) only so the first paint is right before main answers.
- Settings keeps the file's form: a file with a `theme` table keeps a table; otherwise a preference that `theme = "…"` reads back exactly is written as a name, and anything else becomes an inline table.
- An invalid `config.toml` keeps the last valid preference and is reported in Settings → Appearance; Settings refuses to write until the file parses. A theme name Shift does not have falls back to its slot's default with a warning.
- Highlighting a theme in a Settings picker previews it through `previewTheme`, which changes `resolvedTheme` so every renderer redraws; closing the picker restores the preference.

## Codemap

- `lib/themes/index.ts` — theme types, built-in palette registry, selection resolution, and CSS-variable mapping
- `context/ThemeContext.tsx` — the context and `useTheme`, free of the desktop host so browser builds of the canvas can read the theme
- `context/ThemeProvider.tsx` — preference from `config.toml`, preview, first-paint cache, and OS appearance observation
- `components/chrome/settings/ConfigFileSection.tsx` — config file location, Open folder, and file problems
- `src/main/config/` — `AppConfig` (read, watch, write), `configToml` (adapter over the `shift-config` crate), `configDirectory` (per-build folder)
- `components/chrome/settings/AppearanceSettingsPanel.tsx` — mode tabs and one theme picker per slot
- `components/chrome/settings/ThemePicker.tsx` — searchable theme list (built-in, then "Your themes") that previews the highlighted theme
- `packages/editor/src/lib/editor/rendering/Theme.ts` — reads the resolved `--editor-*` variables into `EditorRenderTheme`
- `apps/desktop/themes/` — bundled theme files, one per upstream base16 scheme
- `lib/themes/bundledThemes.test.ts` — contrast check over every built-in and bundled theme
- `apps/desktop/THIRD_PARTY_THEMES.md` — packaged upstream attribution and licenses

## Key Types

- **`ThemeId`** — closed identifier union for bundled palettes; preference slots hold any id, built-in or a user theme file's.
- **`UserColorThemes`** — themes from valid files, plus the files ignored for reusing a reserved id.
- **`ThemePreference`** — a `ThemeMode` (`system | light | dark`) and a `ThemeId` per appearance; `readThemeSetting`/`writeThemeSetting` convert it to and from the file's `theme`.
- **`ThemeAppearance`** — the resolved `light | dark` browser appearance.
- **`ColorTheme`** — metadata plus a complete Base16-style palette.

## How it works

`ThemeProvider` paints from its cached preference, then applies the `theme` main reads from `config.toml` and follows `config.changed`. It observes the OS appearance and resolves one stable `ColorTheme`. `applyResolvedTheme` writes theme metadata and semantic CSS variables before layout effects run. Tailwind utilities consume the `--color-*` variables directly. `CanvasContextProvider` then reads the `--editor-*` variables into `EditorRenderTheme`, updates `Renderer`, rebuilds GPU marker styles, and schedules every canvas layer. Slug uses the resolved theme identity as a redraw key and reads its foreground from computed CSS.

Selecting Shift Light removes runtime overrides so `index.css` remains the first-paint and failure-mode source of its established colors. Other themes write a complete variable set and therefore do not inherit accidental Shift Light roles.

## Workflow recipes

### Adding a bundled theme

1. Copy the scheme's palette from https://github.com/tinted-theming/schemes (`base16/<slug>.yaml`) into `apps/desktop/themes/<slug>.toml`, with the header comment, `name`, and `appearance` the other files use. The slug is the id; keep upstream's.
2. Add a row to the bundled table in `THIRD_PARTY_THEMES.md`.
3. Run `bundledThemes.test.ts`. If a role falls short, add the smallest `[colors]` override that passes and say why in the file.
4. Look at the theme in the app, canvas and markers included.

### Adding a built-in theme

1. Verify that the upstream palette license permits redistribution and add its notice to `THIRD_PARTY_THEMES.md`.
2. Add a stable id to `ThemeId`.
3. Add one complete 16-color entry to `colorThemes`; use six-digit hexadecimal colors so alpha derivation and GPU conversion remain deterministic.
4. Run the color-theme unit tests, desktop lint/typecheck, and the focused theme E2E test.
5. Inspect the application, editor canvas, and marker layer. Do not update visual snapshots without confirming an intentional product change.

## Gotchas

- Changing CSS variables without changing `resolvedTheme` does not notify Canvas 2D or WebGL. Code that changes colors must produce a new `ColorTheme` object, as `userColorThemes` does for every theme file read.
- The first-paint cache (`themeCache`) stores the user themes the preference names, since only main can otherwise supply their palettes.
- `parseCssColor` supports hexadecimal and comma-form RGB/RGBA values. The registry derives compatible RGBA values from six-digit palette entries.

## Verification

- `pnpm --filter @shift/desktop test`
- `pnpm lint:tailwind`
- `pnpm lint:check`
- `pnpm typecheck`
- `pnpm test:e2e:visual e2e/theme.spec.ts --grep "selects and persists"`
- `python scripts/context-drift-check.py`

## Related

- [`@shift/ui` documentation](../../../../../../../../packages/ui/docs/DOCS.md)
- [`Editor` documentation](../../../../../../../../packages/editor/src/lib/editor/docs/DOCS.md)
- [`Graphics` documentation](../../graphics/docs/DOCS.md)
- [`Third-party theme notices`](../../../../../../THIRD_PARTY_THEMES.md)

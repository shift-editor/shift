# Color Themes

<!-- reviewed: 2026-10-06 review-every: 90d -->

Terminal-style color themes for the desktop UI and native editor renderers, built in or defined by the user.

## Architecture Invariants

- A `ColorTheme` is a complete 16-color Base16 palette with a stable `ThemeId` and `ThemeAppearance`. Built-in ids are the closed `BuiltInThemeId` union; user theme ids are `user:<file stem>`.
- `ThemePreferences` holds the `selection` (a theme id or `system`) plus the `light` and `dark` themes that `system` alternates between according to `prefers-color-scheme`. A preference naming a missing theme falls back to Shift Light or Shift Dark for that appearance.
- User themes are owned by main (`UserThemes`) as one Base16 scheme file per theme in `userData/themes`. The renderer never writes theme files; it reads them through `ShiftHost.themes`, and main validates every theme it receives with `parseColorTheme`.
- `applyResolvedTheme` maps one resolved palette into both Tailwind's `--color-*` variables and the editor's `--editor-*` variables. DOM, Canvas 2D, WebGL markers, and Slug must therefore redraw from the same resolved theme.
- Shared UI components consume semantic utilities and never import this registry or depend on theme ids.
- Renderer geometry remains in `EditorRenderTheme`; color themes change appearance, not handle dimensions or hit geometry.
- Shift Light is the no-JavaScript fallback in `index.css`. Selecting it removes runtime variable overrides rather than duplicating the fallback declarations.
- Theme preferences are application-wide and persisted in localStorage under `themeSelection`, `themeLight`, and `themeDark`. They are not font or document data.
- `ThemeContext` must not import the Electron host: the browser editor bundles it. `App.tsx` injects the host's themes API as `userThemeSource`.

## Codemap

- `shared/themes.ts` — `ColorTheme`, Base16 scheme parsing and serialization, and user-id/file-name rules shared by main and renderer
- `main/themes/UserThemes.ts` — main-owned user theme files: list, save, remove, import, export
- `lib/themes/index.ts` — built-in palette registry, preference resolution, and CSS-variable mapping
- `lib/themes/paletteRoles.ts` — what each Base16 slot paints, and new-theme naming
- `context/ThemeContext.tsx` — persisted preferences, user theme list and cache, unsaved preview, OS appearance observation, and cross-window storage synchronization
- `components/chrome/settings/AppearanceSettingsPanel.tsx` — theme gallery, theme actions, and the System light/dark pair
- `components/chrome/settings/ThemeEditor.tsx` — live-preview editor for a user theme's name, appearance, and palette
- `packages/editor/src/lib/editor/rendering/Theme.ts` — reads the resolved `--editor-*` variables into `EditorRenderTheme`
- `apps/desktop/THIRD_PARTY_THEMES.md` — packaged upstream attribution and licenses

## Key Types

- **`BuiltInThemeId`** — closed identifier union for bundled palettes.
- **`ThemeId`** — any built-in or `user:` theme id.
- **`ThemeSelection`** — a concrete `ThemeId` or the `system` resolver mode.
- **`ThemePreferences`** — the selection plus the System light/dark pair.
- **`ThemeAppearance`** — the resolved `light | dark` browser appearance.
- **`ColorTheme`** — metadata plus a complete Base16-style palette.

## How it works

`ThemeContext` restores the preferences, loads user themes from main (painting first from a localStorage copy so a selected user theme does not flash), observes the OS appearance, and resolves one stable `ColorTheme`. While the theme editor is open, its unsaved draft replaces the resolved theme as a preview; unmounting the editor ends the preview. `applyResolvedTheme` writes theme metadata and semantic CSS variables before layout effects run. Tailwind utilities consume the `--color-*` variables directly. `CanvasContextProvider` then reads the `--editor-*` variables into `EditorRenderTheme`, updates `Renderer`, rebuilds GPU marker styles, and schedules every canvas layer. Slug uses the resolved theme identity as a redraw key and reads its foreground from computed CSS.

Selecting Shift Light removes runtime overrides so `index.css` remains the first-paint and failure-mode source of its established colors. Other themes write a complete variable set and therefore do not inherit accidental Shift Light roles.

## Workflow recipes

### Adding a built-in theme

1. Verify that the upstream palette license permits redistribution and add its notice to `THIRD_PARTY_THEMES.md`.
2. Add a stable id to `ThemeId`.
3. Add one complete 16-color entry to `colorThemes`; use six-digit hexadecimal colors so alpha derivation and GPU conversion remain deterministic.
4. Run the color-theme unit tests, desktop lint/typecheck, and the focused theme E2E test.
5. Inspect the application, editor canvas, and marker layer. Do not update visual snapshots without confirming an intentional product change.

### User themes

Users create a theme by duplicating any theme, or import a Base16 scheme file in the classic (`scheme`, `base00: "rrggbb"`) or Tinted Theming (`name`, `variant`, `palette`) shape. A scheme without a `variant` is dark when its background is darker than its text. Saving writes Tinted Theming YAML; an existing JSON file stays JSON. Files dropped into the themes folder appear the next time the list is read; incomplete or unreadable files are skipped. Main broadcasts `themes.changed` after every save, import, and removal so every window updates.

## Gotchas

- Changing CSS variables without changing `resolvedTheme` does not notify Canvas 2D or WebGL. Runtime custom editors will need an explicit palette-change signal.
- `parseCssColor` supports hexadecimal and comma-form RGB/RGBA values. The registry derives compatible RGBA values from six-digit palette entries.
- A user theme's id is fixed by the name it was first saved under; renaming it later keeps the id and file name.
- External edits to theme files are not watched. They appear after the renderer lists themes again, such as on the next launch or the next save from any window.

## Verification

- `pnpm --filter @shift/desktop test`
- `pnpm lint:tailwind`
- `pnpm lint:check`
- `pnpm typecheck`
- `pnpm test:e2e:visual e2e/theme.spec.ts --grep "selects and persists|Custom themes|Imported themes"`
- `python scripts/context-drift-check.py`

## Related

- [`@shift/ui` documentation](../../../../../../../../packages/ui/docs/DOCS.md)
- [`Editor` documentation](../../../../../../../../packages/editor/src/lib/editor/docs/DOCS.md)
- [`Graphics` documentation](../../graphics/docs/DOCS.md)
- [`Third-party theme notices`](../../../../../../THIRD_PARTY_THEMES.md)

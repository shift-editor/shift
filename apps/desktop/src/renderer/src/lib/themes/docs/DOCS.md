# Color Themes

<!-- reviewed: 2026-09-24 review-every: 90d -->

Terminal-style color themes for the desktop UI and native editor renderers.

## Architecture Invariants

- A `ColorTheme` is a complete 16-color semantic source palette with a stable `ThemeId` and `ThemeAppearance`.
- `ThemeSelection` is either a concrete built-in theme id or `system`. System selection resolves only to Shift Light or Shift Dark according to `prefers-color-scheme`.
- `applyResolvedTheme` maps one resolved palette into both Tailwind's `--color-*` variables and the editor's `--editor-*` variables. DOM, Canvas 2D, WebGL markers, and Slug must therefore redraw from the same resolved theme.
- Shared UI components consume semantic utilities and never import this registry or depend on theme ids.
- Renderer geometry remains in `EditorRenderTheme`; color themes change appearance, not handle dimensions or hit geometry.
- Shift Light is the no-JavaScript fallback in `index.css`. Selecting it removes runtime variable overrides rather than duplicating the fallback declarations.
- Theme selection is application-wide and persisted under `themeSelection`. It is not font or document data.

## Codemap

- `lib/themes/index.ts` — theme types, built-in palette registry, selection resolution, and CSS-variable mapping
- `context/ThemeContext.tsx` — persisted selection, OS appearance observation, and cross-window storage synchronization
- `components/chrome/settings/AppearanceSettingsPanel.tsx` — accessible preset gallery
- `lib/editor/rendering/Theme.ts` — reads the resolved `--editor-*` variables into `EditorRenderTheme`
- `apps/desktop/THIRD_PARTY_THEMES.md` — upstream attribution and licenses

## Key Types

- **`ThemeId`** — closed identifier union for bundled palettes.
- **`ThemeSelection`** — a concrete `ThemeId` or the `system` resolver mode.
- **`ThemeAppearance`** — the resolved `light | dark` browser appearance.
- **`ColorTheme`** — metadata plus a complete Base16-style palette.

## How it works

`ThemeContext` restores `themeSelection`, observes the OS appearance, and resolves one stable `ColorTheme`. `applyResolvedTheme` writes theme metadata and semantic CSS variables before layout effects run. Tailwind utilities consume the `--color-*` variables directly. `CanvasContextProvider` then reads the `--editor-*` variables into `EditorRenderTheme`, updates `Renderer`, rebuilds GPU marker styles, and schedules every canvas layer. Slug uses the resolved theme identity as a redraw key and reads its foreground from computed CSS.

Selecting Shift Light removes runtime overrides so `index.css` remains the first-paint and failure-mode source of its established colors. Other themes write a complete variable set and therefore do not inherit accidental Shift Light roles.

## Workflow recipes

### Adding a built-in theme

1. Verify that the upstream palette license permits redistribution and add its notice to `THIRD_PARTY_THEMES.md`.
2. Add a stable id to `ThemeId`.
3. Add one complete 16-color entry to `colorThemes`; use six-digit hexadecimal colors so alpha derivation and GPU conversion remain deterministic.
4. Run the color-theme unit tests, desktop lint/typecheck, and the focused theme E2E test.
5. Inspect the application, editor canvas, and marker layer. Do not update visual snapshots without confirming an intentional product change.

## Gotchas

- Changing CSS variables without changing `resolvedTheme` does not notify Canvas 2D or WebGL. Runtime custom editors will need an explicit palette-change signal.
- `parseCssColor` supports hexadecimal and comma-form RGB/RGBA values. The registry derives compatible RGBA values from six-digit palette entries.
- Theme-file import/export is intentionally separate from the built-in registry. Imported themes require schema validation and migration before `ThemeId` can become an open user-defined identifier.

## Verification

- `pnpm --filter @shift/desktop test`
- `pnpm lint:tailwind`
- `pnpm lint:check`
- `pnpm typecheck`
- `pnpm test:e2e:visual e2e/theme.spec.ts --grep "selects and persists"`
- `python scripts/context-drift-check.py`

## Related

- [`@shift/ui` documentation](../../../../../../../../packages/ui/docs/DOCS.md)
- [`Editor` documentation](../../editor/docs/DOCS.md)
- [`Graphics` documentation](../../graphics/docs/DOCS.md)
- [`Third-party theme notices`](../../../../../../THIRD_PARTY_THEMES.md)

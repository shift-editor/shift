# Desktop E2E tests

Playwright launches the built Electron application against an isolated user-data directory and a native SQLite `.shift` fixture. The suites cover different execution environments and should not share rendering assumptions.

## Commands

Run commands from the repository root:

| Command                       | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `pnpm test:e2e`               | Run required visual and GPU correctness suites |
| `pnpm test:e2e:visual`        | Run deterministic visual and interaction tests |
| `pnpm test:e2e:visual:update` | Regenerate visual snapshots                    |
| `pnpm test:e2e:gpu`           | Run hardware-GPU correctness tests             |
| `pnpm test:e2e:perf`          | Run Playwright performance measurements        |

Append a Playwright file filter for a focused run:

```sh
pnpm test:e2e:visual e2e/home.spec.ts
pnpm test:e2e:visual e2e/document-recovery.spec.ts
pnpm test:e2e:gpu e2e/glyph-grid.spec.ts
```

Build the native bridge first with `pnpm build:native` when its binary is absent or stale. Each E2E command builds the Electron main, workspace, preload, and renderer bundles through `build.ts --e2e`.

## Projects and fixtures

| Project  | Fixture                   | Rendering                                         | CI policy                            |
| -------- | ------------------------- | ------------------------------------------------- | ------------------------------------ |
| `visual` | `fixtures/electronApp.ts` | Software rendering, DPR 1, `1200×600` page window | Required on pull requests and `main` |
| `gpu`    | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Required on pull requests and `main` |
| `perf`   | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Nightly and manual only              |

Visual tests default to MutatorSans. Authored GPU and performance tests default to the MutatorSans designspace and accept another editable source through `SHIFT_E2E_FONT_PATH`. Preview residency tests default to MutatorSans TTF through `SHIFT_E2E_PREVIEW_FONT_PATH`; variable preview scrubbing defaults to Host Grotesk through `SHIFT_E2E_VARIABLE_PREVIEW_FONT_PATH`:

```sh
SHIFT_E2E_FONT_PATH=/path/to/font.designspace pnpm test:e2e:gpu e2e/glyph-grid.spec.ts
SHIFT_E2E_PREVIEW_FONT_PATH=/path/to/font.ttf pnpm test:e2e:gpu e2e/font-preview.spec.ts
SHIFT_E2E_VARIABLE_PREVIEW_FONT_PATH=/path/to/variable.ttf pnpm test:e2e:gpu e2e/variable-font-preview.spec.ts
```

Authored fixtures import their source into a canonical native document under a temporary test root. Tests must not depend on a developer's existing Shift workspace or user-data directory. Document-lifecycle tests inject deterministic Open, ordered Save As destinations, Export, and dirty-document choices through `NativeDialogs`; ordered choices exercise preview-to-`.shift` conversion, Save As adoption, multi-document quit, and re-entrant quit without automating OS pickers. Preview conversion E2E proves successful authored-session handoff and reopen, all four convertible source formats, cancellation and failure cleanup, original-source preservation, and TTF/OTF exclusion. Application-menu tests invoke native Electron menu items rather than bypassing them through the host API, covering command capability and focused text/canvas routing. The recovery fixture restarts Electron with the same isolated user-data directory and document, allowing forced-termination recovery to be tested without touching developer state.

## Visual snapshots

The visual fixture forces a fixed device scale and sizes the `BrowserWindow` that owns the Playwright page. This prevents snapshots from inheriting the host display's scale or available work area.

After an intentional visual change:

1. Run `pnpm test:e2e:visual:update`.
2. Review every changed image under `e2e/__screenshots__/`.
3. Run `pnpm test:e2e:visual` without update mode.

A snapshot match alone does not prove GPU content exists. Rendering tests that can pass with a blank canvas must also compare frames with and without the relevant canvas or assert equivalent semantic output. Route-return tests must make that comparison after navigation because residency attributes do not prove Chromium retained or repainted the WebGPU presentation.

## Selector and interaction rules

- Prefer `getByRole()` and `getByLabel()` for semantic controls and named application regions.
- Use stable domain test IDs when repeated labels cannot identify one record: `source-{id}`, `instance-{id}`, and their `settings-*` variants.
- Reuse surface and control locators from `fixtures/appLocators.ts`; do not traverse parents, select the first `canvas`/`aside`, or depend on styling classes.
- Canvas cells have no DOM identity. Use `openCatalogGlyph()` to filter to one stable glyph ID before clicking; keep the remaining locator-relative coordinate contract inside `clickFirstCatalogGlyph()` rather than scattering layout coordinates across specs.
- Use locator-relative positions for other canvas clicks.
- For raw mouse drags, derive page coordinates from the target canvas's `boundingBox()`.
- Keep interactions inside measured bounds; do not assume the host desktop is wider than the fixture window.
- GPU fixtures must await workspace-window visibility, then apply the final owning `BrowserWindow` size and await the tested page's matching renderer content size; do not let a hidden-to-visible OS adjustment invalidate a baseline.
- Wait for a route, visible surface, animation frame, or domain state instead of assuming startup completed after a fixed delay.
- Use `waitForWorkspaceReady()` for authored workspace startup and `waitForEditorReady()`/`openCatalogGlyph()` for glyph routes. A matching URL alone does not mean React has published the requested scene node.
- Keep negative asynchronous waits limited to behavior where elapsed time is the contract, such as proving a re-entrant quit does not open another confirmation while the first remains pending.
- Do not force software rendering or a fixed DPR in GPU and performance tests.

## Failures and artifacts

Local failures are written to `apps/desktop/e2e/test-results/`. CI uploads the same directory as a Playwright artifact, including screenshots, diffs, traces, error context, and `electron-diagnostics` with window, renderer error/crash, main-process output, and process-exit evidence. Open a trace with:

```sh
pnpm --filter @shift/desktop exec playwright show-trace apps/desktop/e2e/test-results/<test>/trace.zip
```

The project definitions and retry policy live in `apps/desktop/playwright.config.ts`.

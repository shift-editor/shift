# Desktop E2E tests

Playwright launches the built Electron application against an isolated user-data directory and a native SQLite `.shift` fixture. The suites cover different execution environments and should not share rendering assumptions.

## Commands

Run commands from the repository root:

| Command                       | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `pnpm test:e2e`               | Run the normal correctness projects for the current host |
| `pnpm test:e2e:visual`        | Run deterministic visual and interaction tests           |
| `pnpm test:e2e:visual:update` | Regenerate visual snapshots                              |
| `pnpm test:e2e:gpu`           | Run hardware-GPU correctness tests                       |
| `pnpm test:e2e:platform`      | Run cross-platform desktop integration tests             |
| `pnpm test:e2e:perf`          | Run Playwright performance measurements                  |

The default command runs `visual` and `gpu` on macOS, and `platform` on Linux and Windows. Performance measurements are always opt-in.

## Host setup

- **Linux and macOS:** the Nix development shell supplies the pinned Node, pnpm, Rust, native build tools, and Linux virtual-desktop dependencies. Direnv enters it automatically after `.envrc` is allowed; otherwise prefix commands with `nix develop --command`.
- **Windows:** run from a native development shell with Node 24, Corepack/pnpm 11, the repository Rust toolchain, and Visual Studio C++ Build Tools installed. Xvfb and Fluxbox are not used.
- **GPU and performance:** use an active native desktop session with a compatible hardware GPU and driver. The virtual Linux desktop is only for software-rendered visual and platform projects.

Append Playwright file and title filters to run the smallest relevant check:

```sh
pnpm test:e2e:visual e2e/home.spec.ts
pnpm test:e2e:visual e2e/document-recovery.spec.ts --grep "Save As"
pnpm test:e2e:gpu e2e/glyph-grid.spec.ts --grep "source switching"
```

Use repeat mode to reproduce a suspected flake without running the rest of the project:

```sh
pnpm test:e2e:gpu e2e/variable-navigation-glyph-grid.spec.ts \
  --grep "keeps variable preview" --repeat-each=10
```

Each E2E command runs a Turbo `build:e2e` prerequisite, which builds the native bridge, generated bridge types, glyph-info resources, and Electron main, workspace, preload, and renderer bundles through `build.ts --e2e` before Playwright starts; filtering still avoids running unrelated tests.

## E2E impact checks

Before committing a desktop user-flow or rendering change:

1. Search `apps/desktop/e2e/` using the affected surface, command, or workflow name. A production-file change can require an existing E2E test or snapshot update even when no E2E source changed.
2. Run the matching `visual` spec for interface, interaction, menu, lifecycle, persistence, or software-rendered canvas behavior. Run the matching `gpu` spec for hardware rendering, preview residency, or Grid behavior.
3. Use a file and `--grep` filter for a narrow change. Run the complete affected project when the change crosses several flows or shared fixture boundaries.
4. For intentional visual changes, update and inspect the affected snapshots, then rerun the focused visual spec without update mode. The `ci: update visual snapshots` pull-request label can regenerate macOS baselines on the branch when local rendering differs from the hosted runner.
5. Record the exact E2E commands in the pull request. Explicitly state which relevant project was not run and why.

Do not update snapshots merely to make a failure pass. Inspect the diff and confirm that it represents the intended product change.

## Projects and fixtures

| Project    | Fixture                   | Rendering                                         | CI policy                                    |
| ---------- | ------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `visual`   | `fixtures/electronApp.ts` | Software rendering, DPR 1, `1200×600` page window | Required on macOS in the merge queue         |
| `platform` | `fixtures/electronApp.ts` | Software rendering, DPR 1, `1200×600` page window | Required on Windows/Linux in the merge queue |
| `gpu`      | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Required on macOS in the merge queue         |
| `perf`     | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Nightly and manual only                      |

Post-merge `main` workflows do not repeat the E2E suites for the same commit. Rust-changing pushes still build each platform's native module to seed default-branch caches for later merge-queue runs.

The `platform` project concentrates on native desktop boundaries: document lifecycle, Save and Save As, recovery after forced termination, application quit, native menus, Unicode filesystem paths, and import/export persistence. On Linux, the E2E runner automatically creates an isolated `1920×1080×24` Xvfb display with Fluxbox so native maximize, focus, and window-placement behavior has a window manager. Both dependencies are available in the Nix dev shell. GPU and performance behavior remain separate and run directly against the host desktop and GPU.

Outside an active development shell, the portable Linux and macOS invocation is:

```sh
nix develop --command pnpm test:e2e:platform
```

Visual tests default to MutatorSans. Authored GPU and performance tests default to the MutatorSans designspace and accept another editable source through `SHIFT_E2E_FONT_PATH`. Preview residency tests default to MutatorSans TTF through `SHIFT_E2E_PREVIEW_FONT_PATH`; variable preview scrubbing defaults to Host Grotesk through `SHIFT_E2E_VARIABLE_PREVIEW_FONT_PATH`:

```sh
SHIFT_E2E_FONT_PATH=/path/to/font.designspace pnpm test:e2e:gpu e2e/glyph-grid.spec.ts
SHIFT_E2E_PREVIEW_FONT_PATH=/path/to/font.ttf pnpm test:e2e:gpu e2e/font-preview.spec.ts
SHIFT_E2E_VARIABLE_PREVIEW_FONT_PATH=/path/to/variable.ttf pnpm test:e2e:gpu e2e/variable-font-preview.spec.ts
```

Authored fixtures import their source into a canonical native document under a temporary test root. Tests must not depend on a developer's existing Shift workspace or user-data directory. Document-lifecycle tests inject deterministic Open, ordered Save As destinations, Export, and dirty-document choices through `NativeDialogs`; ordered choices exercise preview-to-`.shift` conversion, first-Save replacement of a selected existing destination, Save As adoption, multi-document quit, and re-entrant quit without automating OS pickers. Preview conversion E2E proves successful authored-session handoff and reopen, all four convertible source formats, cancellation and failure cleanup, original-source preservation, and TTF/OTF exclusion. Application-menu tests invoke native Electron menu items rather than bypassing them through the host API, covering command capability and focused text/canvas routing. The recovery fixture restarts Electron with the same isolated user-data directory and document, allowing forced-termination recovery to be tested without touching developer state.

## Visual snapshots

The visual fixture forces a fixed device scale and sizes the `BrowserWindow` that owns the Playwright page. Before normalizing the page to 1200×600, launcher runs assert the native window opened at 800×600. This prevents snapshots from inheriting the host display's scale or available work area without masking launcher sizing regressions.

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

Local failures are written to `apps/desktop/e2e/test-results/`. CI uploads the same directory as a Playwright artifact, including screenshots, diffs, traces, error context, and `electron-diagnostics` with window, renderer error/crash, main-process output, and process-exit evidence. Windows/Linux platform jobs also retain successful evidence for 14 days: launcher, catalog, editor, and reopened-editor screenshots; the generated `.shift` document; the exported TTF; and a runtime/file-hash manifest. These screenshots are inspection artifacts rather than golden visual assertions. Open a trace with:

```sh
pnpm --filter @shift/desktop exec playwright show-trace apps/desktop/e2e/test-results/<test>/trace.zip
```

The project definitions and retry policy live in `apps/desktop/playwright.config.ts`.

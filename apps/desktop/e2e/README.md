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
pnpm test:e2e:visual e2e/variable-navigation.spec.ts \
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
| `platform` | `fixtures/electronApp.ts` | Software rendering, DPR 1, native window geometry | Required on Windows/Linux in the merge queue |
| `gpu`      | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Required on macOS in the merge queue         |
| `perf`     | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Nightly and manual only                      |

Project membership is an explicit list of spec files in `apps/desktop/playwright.config.ts` (`VISUAL_SPECS`, `PLATFORM_SPECS`, `GPU_SPECS`, `PERF_SPECS`). Add a new spec to the list for the environment it needs: `visual` for renderer, interaction, and golden behavior; `platform` for native desktop boundaries; `gpu` only for hardware rendering and residency. Platform specs also run in `visual`, because macOS has no separate platform job. `node scripts/check-e2e-projects.mjs` runs in the Linux E2E build job and fails when a spec belongs to no project or a golden bypasses `fixtures/snapshots.ts`.

The shared fixture option `windowSizing` defaults to `"visual"` in the visual project and `"native"` elsewhere. `prepareWindow` waits for visibility and DOM readiness in both modes, but only visual mode unmaximizes and normalizes the renderer viewport. Platform workflows wait for their relevant controls or workspace readiness without depending on exact snapshot dimensions. Recovery launches use the same policy on every restart. GPU and performance fixture sizing is unchanged.

`window-behavior.spec.ts` explicitly uses `windowSizing: "native"` in both projects. It owns the launcher's 800×600 outer-size assertion, startup-document maximization, and command-driven restore/maximize coverage. Platform-appropriate control coverage remains in `application-menu.spec.ts` and `platform-integration.spec.ts`.

Post-merge `main` workflows do not repeat the E2E suites for the same commit. Rust-changing pushes still build each platform's native module to seed default-branch caches for later merge-queue runs.

The `platform` project concentrates on native desktop boundaries: document lifecycle, Save and Save As, recovery after forced termination, application quit, native menus, Unicode filesystem paths, and import/export persistence. On Linux, the E2E runner automatically creates an isolated `1920×1080×24` Xvfb display with Fluxbox so native maximize, focus, and window-placement behavior has a window manager. Both dependencies are available in the Nix dev shell. GPU and performance behavior remain separate and run directly against the host desktop and GPU.

### Editor driver

Workspace fixtures expose an `editor: EditorDriver` alongside the Playwright `page`. Use the driver for semantic editor actions and domain observations; keep visible UI assertions in the spec:

```ts
test("deletes a selected point", async ({ editor }) => {
  await editor.openGlyphByName("I");
  const before = await editor.outline();

  await editor.clickPoint(before[0].points[1].id);
  await editor.press("Delete");

  expect(await editor.outline()).not.toEqual(before);
});
```

Actions that can persist geometry wait for the workspace edit pipeline before returning. `activeGlyph()`, `outline()`, `pointPosition()`, and `pointTargets()` return fresh domain snapshots; specs should not call `editCoordinator.settled()` directly. Use `livePointPosition()` only for geometry previews during an active gesture. After setup changes geometry or camera state, call `waitForCanvasRender()` before projecting positions or sending pointer input; authored-layer readiness alone does not make the canvas transform and hit regions current. A point target carries glyph-, canvas-, and page-space positions. Prefer `canvasBounds()`, `projectSceneToCanvas()`, `projectSceneToPage()`, and `projectCanvasToScene()` over repeating DOM offsets and renderer projections in specs.

Pointer helpers use page coordinates for `pointerDown()`, `pointerMove()`, and `pointerUp()`. `dragCanvas()` accepts canvas-local endpoints. Gestures follow `idle → pressed → dragging → idle`; `cancelGesture()` returns a pressed or dragging gesture to `idle` after application rollback. Live observations such as `selectionBounds()`, `hoverId()`, and `toolState()` intentionally expose the current preview. Use `waitForIdle()` only after raw Playwright gestures that cannot be expressed as one driver action.

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

### Process and dialog ownership

Every Electron process a test starts belongs to the `electronProcesses` fixture. The initial launch, `relaunch()`, and the recovery fixture's restarts verify the isolated user-data directory, prepare the first window with the project's sizing, and record main-process output and renderer failures. Teardown attaches `electron-diagnostics-<launch>` for failed tests and terminates every process tree, including launches left running by a timed-out test. Specs never kill applications they obtained from a fixture; use `killApp()` only to simulate a crash before a relaunch.

Renderer `alert`, `confirm`, `prompt`, and `beforeunload` dialogs are dismissed and recorded. A test that opens one fails at teardown unless it sets `allowRendererDialogs: true`. Native dialogs are scripted through `NativeDialogs` instead.

GPU and preview fixtures in `fixtures/perfApp.ts` also expose `editor: EditorDriver` for the primary page. Construct a driver directly only for additional windows.

Every Electron launch, relaunch, and second instance builds its environment with `shiftTestEnvironment()`, which drops inherited `SHIFT_E2E_*` variables before applying the fixture's own. A shell-exported `SHIFT_E2E_FONT_PATH` for GPU runs therefore cannot open extra documents in visual or platform tests.

Authored fixtures import their source into a canonical native document under a temporary test root. Tests must not depend on a developer's existing Shift workspace or user-data directory. Document-lifecycle tests inject deterministic Open, ordered Save As destinations, Export, and dirty-document choices through `NativeDialogs`; ordered choices exercise preview-to-`.shift` conversion, first-Save replacement of a selected existing destination, Save As adoption, multi-document quit, and re-entrant quit without automating OS pickers. Preview conversion E2E proves successful authored-session handoff and reopen, all four convertible source formats, cancellation and failure cleanup, original-source preservation, and TTF/OTF exclusion. Application-menu tests invoke native Electron menu items rather than bypassing them through the host API, covering command capability and focused text/canvas routing. The recovery fixture restarts Electron with the same isolated user-data directory and document, allowing forced-termination recovery to be tested without touching developer state.

## Visual snapshots

The visual fixture forces a fixed device scale and sizes the `BrowserWindow` that owns the Playwright page to a 1200×600 renderer viewport. Native launcher sizing and startup maximization are tested separately in `window-behavior.spec.ts`, before normalization can mask regressions. Exact snapshot dimensions are not a prerequisite for platform workflows.

After an intentional visual change:

1. Run `pnpm test:e2e:visual:update`, optionally with a file and `--grep` filter.
2. Review every changed image under `e2e/__screenshots__/`.
3. Run the same visual scope without update mode.

### Writing golden assertions

Golden captures are the final assertion of a behavioral test, taken with the helpers in `fixtures/snapshots.ts`:

- `expectCanvasSnapshot(editor, name)` waits for pending edits and two rendered frames, then compares the composited canvas stack (`editorCanvasStack()`) on every host with `maxDiffPixels: 0` and `threshold: 0.02`. Hosts differ only in antialiased edge pixels (per-pixel delta ≤ 0.009), while a real colour-token change such as the comparison-outline colour moves pixels by about 0.07. Playwright's default per-pixel threshold of 0.2 would accept that change, so never raise it.
- `expectPanelSnapshot(locator, name)` captures the smallest panel, menu, or toolbar that owns the visual contract with scrollbar gutters normalized, animations disabled, and the caret hidden. `expectPageSnapshot(page, name)` applies the same options to a whole window; reserve it for overall composition.
- Interface goldens (panel and page) are also exact, but they are compared on CI only and their baselines come only from the hosted runner through the `ci: update visual snapshots` label. Text antialiasing differs between development Macs and the runner, so local runs attach the capture for inspection instead of comparing or writing it. Keep interface goldens few; assert controls, labels, and state semantically first.
- Never call `toHaveScreenshot()` directly in a spec. The helpers are the only golden path, and `scripts/check-e2e-projects.mjs` enforces it.
- Goldens do not pass on retry. CI retries a failed test once to collect a second trace, but every snapshot helper throws on a retry attempt, so a test with a golden that failed once stays failed. Explain the first failure instead of rerunning it.
- The helpers use `toHaveScreenshot()`. It waits for two identical consecutive captures; `toMatchSnapshot()` on a screenshot buffer does not stabilize and ignores the configured screenshot tolerance.
- Prove the state that owns the pixels before capturing it: the authored point count after each Pen gesture, the tool state during a drag, or the published render state of a preview.
- Express canvas gestures with `editor.canvasPagePoint()` fractions of the interactive canvas, and choose positions away from existing geometry so a click cannot hit an unintended target.
- Park the pointer off the target before capturing toolbars and menus so hover styling and tooltips are not part of the golden.
- Do not count or sample palette colours. Assert the render state the editor publishes, or capture a golden of the state.
- Canvas goldens keep device pixels (`scale: "device"`). A HiDPI spec sets Playwright's `deviceScaleFactor` option (`test.use({ deviceScaleFactor: 2 })`), which the Electron fixtures pass to `--force-device-scale-factor`; window sizing stays in CSS pixels, so a 2× canvas golden is twice the 1× dimensions. Assert `window.devicePixelRatio` before capturing.
- Theme goldens persist the selection (`localStorage.themeSelection`), reload, and assert `data-color-theme` before capturing. Shift Light uses stylesheet defaults; every other theme maps its palette through a light or dark branch of `colorThemeVariables()`, so add a theme golden when a new theme changes that mapping rather than for each palette.

### Visual contracts

Each golden protects one contract; prefer extending the owning spec over adding a new capture of the same state.

| Contract                        | Goldens                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Glyph outlines, handles, guides | `glyph-rendering`: `canvas-{S,B,I,Q}-composited`; `editor`: `editor-canvas-A`                                                |
| Selection chrome                | `glyph-rendering`: `canvas-S-all-selected`, `segment-selected`, `segment-translating`; `editor`: `segment-upgrade-preview`   |
| Pen previews                    | `glyph-rendering`: `pen-*`                                                                                                   |
| Shape drafts                    | `tools`: `{Rectangle,Ellipse}-{draft,committed}`                                                                             |
| High zoom                       | `glyph-rendering`: `canvas-S-high-zoom`                                                                                      |
| 2× device scale                 | `hidpi-rendering`: `canvas-S-all-selected-2x`                                                                                |
| Theme palette mapping           | `theme`: `canvas-S-all-selected-{shift-dark,solarized-light}`, `editor-shift-dark`, `theme-light-home`                       |
| Variation outlines              | `variation-outlines`: `outline-source`, `outline-interpolated-instance`                                                      |
| Interpolated handles            | `handle-styling`: `handles-interpolated-instance`                                                                            |
| Components                      | `component-rendering`: `canvas-Aacute-bold-wide-components`, `canvas-Aacute-interpolated-components`                         |
| Panels and chrome               | `editor` sidebar and transform panels, `editor-glyph-A`; `tools` toolbar and shape menu; `home`; `landing`; `preview-notice` |

### Capture determinism

A fixed viewport and DPR do not fix native scrollbar preferences. Overlay and reserved-gutter scrollbars can give the same sidebar different usable widths. Normalize host-dependent decoration only during golden captures when it is not the behavior under test; keep interaction and visibility assertions on the unmodified layout.

Playwright's capture APIs have different contracts: `toHaveScreenshot()` accepts **`stylePath`**, while `screenshot()` accepts **`style`** containing CSS text. Use the same stylesheet for assertions and attached captures, reading its contents for `screenshot()`. Check the installed API types rather than assuming options transfer between APIs. `pnpm typecheck` includes the E2E project through `pnpm --filter @shift/desktop typecheck:e2e`, so specs are checked against the renderer's `window.shift` and `window.shiftSession` declarations.

After inspecting changed baselines, verify without snapshot updates and with `--retries=0`, then repeat the affected test. Reproduce the environmental difference that caused the failure: repeated passes with overlay scrollbars alone do not prove reserved-gutter layouts work. For gutter-related failures, also exercise a measured reserved gutter and verify that controls remain visible and usable. An update-mode pass is baseline generation, not verification; a skipped PR E2E job is not validation.

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
- Do not use `waitForTimeout()`. After a quit or close request, wait for the scripted answer with `dirtyDocumentDecisions()` and count confirmations with `dirtyDocumentRequests()`; each read is a main-process round trip, so the close guard has already reacted to the recorded decision.
- When elapsed time is itself the contract, as for wheel-gesture momentum, dispatch the samples inside the page and wait on the page clock that stamps the events rather than sleeping in Playwright.
- Do not force software rendering or a fixed DPR in GPU and performance tests.

## Failures and artifacts

Local failures are written to `apps/desktop/e2e/test-results/`. CI uploads the same directory as a Playwright artifact, including screenshots, diffs, traces, error context, and `electron-diagnostics` with window, renderer error/crash, main-process output, and process-exit evidence. `collectWindowDiagnostics` records native outer/content bounds, visibility, minimize/maximize state, zoom factor, display bounds/work area/scale, and renderer dimensions/DPR. Native and renderer inspection failures are recorded independently. Recovery launch failures include geometry in the error before terminating Electron. Windows/Linux platform jobs also retain successful evidence for 14 days: launcher, catalog, editor, and reopened-editor screenshots; the generated `.shift` document; the exported TTF; and a runtime/file-hash manifest. These screenshots are inspection artifacts rather than golden visual assertions. Open a trace with:

```sh
pnpm --filter @shift/desktop exec playwright show-trace apps/desktop/e2e/test-results/<test>/trace.zip
```

### Retries, flaky tests, and reports

CI runs with `retries: 1` so a failure collects a second trace; traces are kept for every failed attempt (`retain-on-failure`) because the first failure of a flaky test is the evidence. A test that passes only on retry is flaky, not green:

- Each shard writes a blob report, uploaded as `blob-report-<target>-<shard>`.
- The informational `E2E Report` job merges every shard into one HTML report (artifact `playwright-report-<run>`) and runs `scripts/summarize-e2e-report.mjs`. The job summary lists failed, flaky, and slow tests per project, and each flaky test gets a `::warning` annotation on its spec line.
- `reportSlowTests` lists spec files slower than 20 seconds in each shard log.

Summarize a local JSON report with `node scripts/summarize-e2e-report.mjs <report.json>`.

The project definitions and retry policy live in `apps/desktop/playwright.config.ts`.

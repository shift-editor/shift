# Desktop E2E tests

Playwright launches the built Electron application against an isolated user-data directory and a copied workspace. The suites cover different execution environments and should not share rendering assumptions.

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
pnpm test:e2e:gpu e2e/glyph-grid.spec.ts
```

Build the native bridge first with `pnpm build:native` when its binary is absent or stale. Each E2E command builds the Electron main, workspace, preload, and renderer bundles through `e2e/build.ts`.

## Projects and fixtures

| Project  | Fixture                   | Rendering                                         | CI policy                            |
| -------- | ------------------------- | ------------------------------------------------- | ------------------------------------ |
| `visual` | `fixtures/electronApp.ts` | Software rendering, DPR 1, `1200×600` page window | Required on pull requests and `main` |
| `gpu`    | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Required on pull requests and `main` |
| `perf`   | `fixtures/perfApp.ts`     | Hardware GPU, host scale, stable content size     | Nightly and manual only              |

Visual tests default to MutatorSans. The GPU and performance fixture also defaults to MutatorSans, but accepts a real font or designspace through `SHIFT_E2E_FONT_PATH`:

```sh
SHIFT_E2E_FONT_PATH=/path/to/font.ttf pnpm test:e2e:gpu e2e/glyph-grid.spec.ts
```

Fixtures copy source files into a temporary workspace. Tests must not depend on a developer's existing Shift workspace or user-data directory.

## Visual snapshots

The visual fixture forces a fixed device scale and sizes the `BrowserWindow` that owns the Playwright page. This prevents snapshots from inheriting the host display's scale or available work area.

After an intentional visual change:

1. Run `pnpm test:e2e:visual:update`.
2. Review every changed image under `e2e/__screenshots__/`.
3. Run `pnpm test:e2e:visual` without update mode.

A snapshot match alone does not prove GPU content exists. Rendering tests that can pass with a blank canvas must also compare frames with and without the relevant canvas or assert equivalent semantic output.

## Interaction rules

- Use locator-relative positions for canvas clicks.
- For raw mouse drags, derive page coordinates from the target canvas's `boundingBox()`.
- Keep interactions inside measured bounds; do not assume the host desktop is wider than the fixture window.
- GPU fixtures must await workspace-window visibility, then apply the final owning `BrowserWindow` size and await the tested page's matching renderer content size; do not let a hidden-to-visible OS adjustment invalidate a baseline.
- Wait for a route, visible surface, animation frame, or domain state instead of assuming startup completed after a fixed delay.
- Do not force software rendering or a fixed DPR in GPU and performance tests.

## Failures and artifacts

Local failures are written to `apps/desktop/e2e/test-results/`. CI uploads the same directory as a Playwright artifact, including screenshots, diffs, traces, and error context. Open a trace with:

```sh
pnpm --filter @shift/desktop exec playwright show-trace apps/desktop/e2e/test-results/<test>/trace.zip
```

The project definitions and retry policy live in `apps/desktop/playwright.config.ts`.

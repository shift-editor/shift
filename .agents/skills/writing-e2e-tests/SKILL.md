---
name: writing-e2e-tests
description: Canonical rules for writing, rewriting, or reviewing Shift desktop Playwright E2E tests and visual goldens under `apps/desktop/e2e/`. Use whenever you add or change a `.spec.ts`, a fixture, `EditorDriver`, a screenshot baseline, or Playwright project membership, and whenever you investigate a flaky or failing E2E test. Covers waits, oracles, goldens, fixtures, projects, and flake verification.
---

# /writing-e2e-tests — How desktop E2E tests are written

An E2E test is worth its cost only when it fails for exactly one reason: the user-visible behavior it names is broken. It must not fail because the machine was slow, the theme changed, a sidebar moved, or a retry happened to pass.

Read `/writing-tests` first for the general rules (observable state, no mocks, migration ledgers). Read `apps/desktop/e2e/README.md` for the full fixture and project reference. This skill is the checklist that turns those into a test that stays green for the right reasons.

## Choose the layer before writing anything

| The behavior is…                                                                                          | Owning test                                       |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Pure computation (layout math, latch rules, range selection)                                              | Pure unit test — extract the function first       |
| Observable through editor state after a click, drag, or key                                               | `TestEditor` tool or command test                 |
| A real browser or Electron contract (DOM events, focus, native menus, dialogs, windows, processes, files) | Semantic Playwright test                          |
| Appearance: colours, strokes, handles, layout                                                             | One focused golden, after a semantic precondition |
| Hardware rendering, GPU residency, WebGPU presentation                                                    | `gpu` project test                                |
| Save, quit, crash, recovery, file activation, cross-OS paths                                              | `platform` project test                           |

If most assertions in a draft E2E test read editor state after `page.evaluate`, the behavior probably belongs in `TestEditor`. Keep the E2E test as a thin proof that the real UI reaches it.

## Waiting: never sleep

`waitForTimeout` is banned. Wait for the condition that makes the next step valid:

| Before you…                                                                                      | Wait for                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Read geometry, project coordinates, or send pointer input after setup changed geometry or camera | `editor.waitForCanvasRender()`                                                                                     |
| Assert after raw `page.mouse` moves                                                              | `editor.flushPointerMoves()`, then `waitForCanvasRender()` or `waitForIdle()`                                      |
| Act on an editor route                                                                           | `waitForEditorReady()` / `openCatalogGlyph()` (works for authored and preview sessions)                            |
| Click a catalog cell by coordinates                                                              | `clickFirstCatalogGlyph()` — it waits for a laid-out, settled Grid                                                 |
| Act on a workspace                                                                               | `waitForWorkspaceReady()`                                                                                          |
| Assert after quit or close                                                                       | `dirtyDocumentDecisions()` / `dirtyDocumentRequests()` — main-process records, not elapsed time                    |
| Compare Grid frames after an edit                                                                | Published Grid state (`data-grid-readiness`, `data-atlas-build-count`, active location), armed after setup settles |

When elapsed time is itself the contract (debounce, momentum, idle timeouts), put the rule in a pure function driven by timestamps and unit-test it. If the E2E test must remain, dispatch events inside the page and wait on the page clock (`performance.now()`) that stamps them. `glyph-view.spec.ts` zoom momentum is the template.

Negative assertions ("nothing else happened") need a positive anchor: wait for the event that would have triggered the unwanted outcome, then assert the outcome is absent.

## Oracles: assert what the editor decided, not what pixels look like

Never count or sample hard-coded colours from a canvas. Colour oracles break under themes, alpha, anti-aliasing, device scale, and renderer changes, and many pass when the feature is broken (an empty canvas has zero "wrong" pixels).

Use published state instead:

- geometry: `editor.outline()`, `pointPosition()`, `selectionIds()`, `selectionBounds()`;
- interaction: `toolState()`, `hoverId()`, `activeSnapGuides()`;
- rendering decisions: `visibleOutlines(nodeId)` and `handleStates(node)` on the glyph node definition;
- UI state: roles, accessible names, `aria-pressed`, `aria-checked`, `aria-disabled`, `data-*` state published for tests;
- persistence: `savedGlyphNames()` for `.shift` files and `exportedGlyphNames()` for exported fonts — never `existsSync`, byte inequality, or `size > 0`.

If the state you need is not published, publish it from the production code that renders it (same computation, not a parallel reimplementation), add a unit test for it, then assert it. That is how `visibleOutlines` and `handleStates` were added.

Assertions must be exact enough to fail on the wrong answer:

- assert the exact set or order, not `count() > N` or `not.toEqual(before)`;
- derive expectations from the fixture or the UI (for example, read the ordered category buttons and compute the expected range) instead of hard-coding one neighbour;
- run the mental-deletion check: if the feature were a no-op, would this assertion fail?

## Goldens: one contract, one focused capture

All goldens go through `fixtures/snapshots.ts`; `scripts/check-e2e-projects.mjs` rejects `toHaveScreenshot` or `toMatchSnapshot` anywhere else.

- `expectCanvasSnapshot(editor, name)` — the editor canvas stack, exact comparison, after the canvas has rendered.
- `expectPanelSnapshot(locator, name)` — one panel, menu, toolbar, or dialog.
- `expectPageSnapshot(page, name)` — full window; use sparingly, only for overall chrome.

Before every golden:

1. Assert the semantic precondition that makes the image meaningful: the point count, selection, tool state, outline targets, handle states, zoom, active theme (`data-color-theme`), or `devicePixelRatio`.
2. Park the pointer off the captured element unless hover is the contract.
3. Capture the smallest element that shows the contract. Do not use a full-page golden to protect a toolbar button.

Rules:

- One golden per distinct visual contract. Do not add near-duplicate images; if two captures are byte-identical, one of them is redundant.
- Canvas goldens compare exactly (`maxDiffPixels: 0` and `threshold: 0`) on every host. Never raise tolerance or the per-pixel threshold to make a mismatch pass; the default threshold silently accepts colour-token changes.
- Interface goldens (`expectPanelSnapshot`, `expectPageSnapshot`) are exact but compared on CI only, with baselines generated on the runner via the `ci: update visual snapshots` label. Never commit a locally generated interface baseline. Prefer semantic assertions and keep interface goldens few.
- Goldens never pass on retry. The helpers throw on a retry attempt, so explain the first failure.
- Use canvas-local positions (`dragCanvas()`, `canvasPagePoint()`) so layout changes cannot redraw geometry.
- Theme goldens select the theme through the product and assert `data-color-theme` first. HiDPI goldens use `test.use({ deviceScaleFactor: 2 })` and assert `devicePixelRatio` first. Add one golden per palette branch or rendering path, not one per theme.

Updating baselines: only for an intentional appearance change. Run the focused spec with `--update-snapshots -g "<title>"`, open every changed PNG and describe what changed, then rerun without update mode and with `--retries=0 --repeat-each=3`. Canvas baselines may be generated locally. Interface baselines are generated only by the `ci: update visual snapshots` label; inspect the runner-generated images before merging.

## Fixtures and isolation

- Use the shared `editor` fixture; construct `EditorDriver` directly only for additional windows.
- Relaunch through the `relaunch` fixture, never raw `electron.launch`. The process registry owns every launched tree, attaches diagnostics, and kills it even when the test times out.
- Every launch environment comes from `shiftTestEnvironment()`. Never spread `process.env` into a launch.
- Script native dialogs with the fixture options (`dirtyDocumentChoice(s)`, `saveShiftPaths`, `openFontPath`). An unexpected renderer dialog fails the test; opt in with `allowRendererDialogs` only when the dialog is the behavior.
- Put shared setup in fixtures or `EditorDriver` (`openScratchGlyph()`, `commitInputValue()`, `toolButton()`), not copied helpers in specs. Do not grow `EditorDriver` with one-off helpers.
- Prefer `getByRole()` / `getByLabel()` and locators from `fixtures/appLocators.ts`. No parent traversal (`locator("..")`), no styling classes, no `toHaveCSS()` unless the style value is the product contract.

## Structure

- One behavior per test. Split long flows when an early failure would hide unrelated coverage.
- Do not accumulate state across unrelated steps; start each test from a fixture.
- Setup may use `page.evaluate` or `insertContent`; the behavior under test must go through the user surface.
- Name tests after the behavior: "shift-selects glyph categories as a visible range", not "category test".

## Projects

Membership is explicit in `apps/desktop/playwright.config.ts`. Add a new spec to the right list — `visual`, `platform`, `gpu`, or `perf` — and run `node scripts/check-e2e-projects.mjs`. A spec that needs native lifecycle behavior on Windows and Linux belongs in `platform`. A spec whose only GPU dependency is incidental belongs in `visual`.

## Proving a test is not flaky

Before committing a new or changed E2E test:

```sh
pnpm test:e2e:visual e2e/<spec>.spec.ts -g "<title>" --repeat-each=10 --retries=0
```

For timing-sensitive flows, repeat under CPU load (for example, several `yes > /dev/null &` processes, killed afterwards), because CI runners are slower than development machines. For platform behavior, rely on the Windows and Linux CI jobs and say so in the pull request.

When a test fails or flakes:

1. Read the trace and `electron-diagnostics` before changing anything.
2. Classify it: product regression, test oracle, or infrastructure. Do not call a single failure flaky without a retry pass or a rerun on the same commit.
3. Fix the oracle or the wait. Never add a sleep, a retry, or tolerance, and never regenerate a baseline without understanding the diff.

The CI "E2E Report" job lists tests that passed only on retry. Treat every entry as a bug to fix, not noise.

## Review checklist

- [ ] The layer is right; logic that `TestEditor` can observe is tested there.
- [ ] No `waitForTimeout`, no fixed delays, and no polling without a semantic condition.
- [ ] No colour counting, pixel sampling, byte inequality, or "something changed" oracle.
- [ ] Assertions are exact and fail when the feature is a no-op.
- [ ] Every golden goes through `fixtures/snapshots.ts`, captures one contract at the smallest element, and follows a semantic precondition.
- [ ] Changed baselines were inspected and verified with `--retries=0`.
- [ ] Launches, relaunches, and dialogs go through fixtures.
- [ ] The spec belongs to the intended project, and the project check passes.
- [ ] The test passed `--repeat-each=10 --retries=0`, and the pull request lists the exact E2E commands and any coverage not run.

# Plan: `a-stroke-panel`

**Spec:** [SPEC-a-stroke-panel.md](./SPEC-a-stroke-panel.md) (D1–D3 decided)  
**Branch:** `explore/strokes` (local only)  
**Status:** not started; waits on `a-stroke-position` (its Rust and style changes land first) and Tasos's go. Decided: D1 drop the style dialogs, D2 icon rows, D3 position moved to `a-stroke-position` (spike done, see SPIKE-a-stroke-position.md).

## Overview

Put every stroke command and style field on screen using components the app already has: a Stroke section in the right sidebar, its `⋯` menu, context-menu items, an Offset dialog, and native-menu routing. One Rust prerequisite: a read that returns each dynamic contour's stored style.

## Architecture decisions

- **One read, Rust-owned.** `live_strokes(layer)` returns `{ contourId, style }` for each dynamic contour, next to `live_stroke_contours`, generated through the same `EngineReads` path. The TS `liveStrokeContours` becomes the ids of that list; one source of truth.
- **The sidebar is a view over one pure model.** `strokeSectionModel(selection)` returns which controls show and what they read ("Mixed" per field). The React section only renders it. This is where the rules are tested.
- **Edits go through one command**, `updateStrokeStyle(editor, patch)`, so a sidebar commit, a future dialog and agents share it. It merges per contour and calls `setLiveStroke` per distinct result in one transaction.
- **Last-set style is a small cell** in the stroke commands module (default round, width 20), written by `applyDynamicStroke` and `updateStrokeStyle`, read by the menu's `Apply Dynamic Stroke`. Session only.
- **Dialogs follow `SetSidebearingsDialog`** and open through renderer state, as `glyph.addComponent` does. Only Offset needs one under D1.
- **Refusals notify.** Controls stay clickable with `aria-disabled`; a refused press calls `notify(reason)`.

## Dependency graph

```
P1 Rust read (live_strokes) ─► P2 TS read path ─► P3 selection styles + updateStrokeStyle
                                                        │
                                   P4 section view model ◄┘
                                          │
              P5 icons + Stroke section ◄─┘ ─► P6 ⋯ menu
                                          │
              P7 Offset dialog + routing ◄┤
              P8 context menu items ◄─────┘
                                          ▼
                                P9 verify, docs, Checkpoint D
```

## Tasks

### Phase 1: Read and commands (no UI)

- [x] **P1. Engine read `live_strokes`** (S)
  - Acceptance: returns each dynamic contour's id and stored style; nothing for a plain contour or a layer without strokes; reads the previewed font while a gesture is live; solves nothing.
  - Verify: `cargo test -p shift-font -p shift-wasm --features shift-wasm/engine`; `cargo clippy ... --all-targets`; `pnpm build:wasm`; `pnpm generate:from-rust`.
  - Files: `shift-font/src/stroke/live_stroke.rs`, `shift-wasm/src/engine_reads.rs`.
- [x] **P2. TS read path** (S)
  - Acceptance: `font.liveStrokes(layerId)` returns the list, re-runs readers after `setLiveStroke`, a style edit, an undo and `removeLiveStroke`; `liveStrokeContours` derives from it.
  - Verify: `pnpm turbo run test --filter=@shift/editor -- src/lib/wasm/strokeOutlinePreviews.test.ts`.
  - Files: `engineModule.ts`, `SessionEngine.ts`, `Font.ts`, `types/font.ts`.
- [x] **P3. Styles in the selection, `updateStrokeStyle`, last-set style** (M)
  - Acceptance: `resolveStrokeSelection` carries each dynamic contour's style; `updateStrokeStyle({ width })` changes only width, per contour, in one undo step; two contours with different joins keep them; width ≤ 0 returns the reason and changes nothing; `Apply Dynamic Stroke` from the menu uses the last-set style.
  - Verify: `pnpm test:desktop src/renderer/src/lib/commands`.
  - Files: `strokeCommands.ts`, `strokeAvailability.ts`, `strokeMenuCommand.ts`, `types/stroke.ts`, tests.

#### Checkpoint A (agent, no UI yet)

- [x] Rust and desktop tests, clippy, typecheck, lint green. Mutation check on `updateStrokeStyle` (drop the per-contour merge, expect a red test).

### Phase 2: The sidebar

- [x] **P4. Section view model** (S)
  - Acceptance: table-driven tests cover none / all / mixed dynamic, open vs closed, equal vs different values ("Mixed"), miter limit only for Miter, cap row only with an open dynamic contour, read-only and inactive-source states.
  - Verify: `pnpm test:desktop src/renderer/src/components/editor/sidebar-right/strokeSection.test.ts`.
  - Files: `sidebar-right/strokeSectionModel.ts` and its test (types in `types/stroke.ts`).
- [x] **P5. Icons, Stroke section, wiring** (M)
  - Acceptance: section appears for selected contours (not while the Text tool is active); `+` adds a stroke; Width, Join, Miter limit, Cap edit live and each commit is one undo step; controls built from `SidebarSection`, `SidebarNumberField`, `IconButton`, `Row`; six placeholder SVGs; refused presses notify.
  - Verify: `pnpm typecheck`, `pnpm lint:check`, `pnpm format:files`; manual look (see Checkpoint B).
  - Files: `sidebar-right/StrokeSection.tsx`, `RightSidebar.tsx`, `assets/sidebar-right/{cap,join}-*.svg`.
- [x] **P6. Section `⋯` menu** (S)
  - Acceptance: Expand Stroke, Remove Dynamic Stroke, Offset Contour… from a `Menu` opening beside the sidebar; unavailable ones notify the reason.
  - Files: `sidebar-right/StrokeSection.tsx` (or `StrokeMenu.tsx`).

#### Checkpoint B (Tasos)

- [ ] Run `nix develop --command pnpm dev`. Select an open contour: `+`, change width, cap, join, miter; expand; undo; remove. Look at structure and behaviour only; visuals are yours afterwards.

### Phase 3: Dialog and entry points

- [ ] **P7. Offset dialog and menu routing** (M)
  - Acceptance: `Offset Contour…` (native menu, section menu, context menu) opens a panel dialog with Distance, Join, Miter limit when Miter, inline error; Apply runs `offsetContour`; any contour once `a-stroke-position` has landed; the distance label says the sign follows the path direction.
  - Verify: behaviour test that the command opens the dialog and Apply changes the contour; typecheck, lint.
  - Files: `components/editor/OffsetContourDialog.tsx`, `context/SettingsNavigationProvider.tsx` (or the editor view), `rendererCommands.ts`.
- [ ] **P8. Canvas context menu items** (S)
  - Acceptance: after "Make First Point", **Add Dynamic Stroke**, **Expand Stroke**, **Remove Dynamic Stroke**, **Offset Contour…** appear only when they would run.
  - Verify: behaviour test on availability; manual.
  - Files: `CanvasContextMenu.tsx`.

### Phase 4: Close

- [ ] **P9. Verify and document** (S)
  - Acceptance: `pnpm test` green; ROADMAP A3.1 ticked with what is and is not done; SPEC-map status; `DOCS.md` for the stroke UI per `docs/architecture/index.md`; `python3 scripts/context-drift-check.py` passes.

#### Checkpoint C (Tasos)

- [ ] Context menu, native menu and Offset dialog by hand; then the UI polish pass.

## Risks and mitigations

| Risk                                                                                 | Impact | Mitigation                                                                                          |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| A number field commits on every arrow press, so scrubbing a width fills undo history | Medium | Same as Transform today; revisit only if it hurts at Checkpoint B                                   |
| Mixed selections (some plain, some dynamic) confuse what a field edit does           | Medium | Spec rule: edits apply to dynamic contours only; `+` converts the rest. Covered by view-model tests |
| Six placeholder icons look wrong                                                     | Low    | Declared placeholders; your polish pass                                                             |
| `Expand Stroke…` disappears from the menu if D1 = drop                               | Low    | The command remains for agents and tests; only the menu entry and its dialog are not built          |
| Native menu cannot show a disabled state per selection                               | Low    | Known (commands spec Q-cmd-2); refusals notify                                                      |

## Open questions

None. D1–D3 are decided in the spec.

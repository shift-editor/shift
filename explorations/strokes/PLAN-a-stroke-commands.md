# Plan: `a-stroke-commands`

**Spec:** [SPEC-a-stroke-commands.md](./SPEC-a-stroke-commands.md) (approved 2026-11-20)  
**Branch:** `explore/strokes` (local only)  
**Tasks tracked here** (no external tracker; no repo-root `tasks/` directory on this branch).

## Overview

Make `SetLiveStroke`, `BakeStrokeOutlines`, `OutlineStroke` and `OffsetContour` callable from the editor through five `glyph.stroke.*` commands, with one availability function that returns a reason and a notification when an unavailable command runs from the native menu. One small Rust addition: a `RemoveLiveStroke` intent and a cheap "which contours are dynamic" read.

## Architecture decisions

- **Dynamic = a `Skeleton` lib entry that has an `outline_style`.** That is exactly what preview and bake consume, so the read and the intents agree. Rust: `GlyphLayer::live_stroke_contour_ids`.
- **The read goes through the existing generated path.** `EngineReads` trait method `live_stroke_contours(layer_id)`, same shape and error type as `stroke_outline_previews`; the wasm export and `@shift/wasm/protocol` types are generated from the trait. TS threads it through `engineModule` → `SessionEngine` → `Font` like `strokeOutlinePreviews`, tracking `revision("layers")`.
- **`RemoveLiveStroke` is strict in Rust** (errors on a contour with no live entry, like Bake). The mixed-selection rule (Q-cmd-4) is applied in TypeScript by filtering with the read, so Rust stays the single owner of what "dynamic" means.
- **Commands are plain functions over `Editor`**, returning `StrokeCommandResult` (`{ ok: true } | { ok: false, reason }`), in `apps/desktop/src/renderer/src/lib/commands/` (`TestEditor` is desktop-only, so the tests live beside the commands). Availability is a pure function over a small input (selection facts), unit-testable table-driven.
- **Expand matrix in one `editor.transaction`:**

  | selection | keepEditable | intents |
  | --------- | ------------ | ------- |
  | any | on | `SetLiveStroke(all selected)` |
  | fill-only | off | `OutlineStroke` |
  | dynamic | off | `SetLiveStroke(style)` then `BakeStrokeOutlines` |
  | mixed | off | dynamic part: `SetLiveStroke` + `Bake`; fill part: `OutlineStroke` |

- **Notification:** a module-level `notify(message)` emitter in the renderer plus one `AppNotifications` component under a `ToastProvider` in `App.tsx`. Main→renderer IPC is fire-and-forget (the bool is ignored), so the renderer's command runner shows the reason when a stroke command refuses.
- **Interim menu defaults (until `a-stroke-panel` adds dialogs).** Main sends only a command id, so argument commands run with named default styles from the menu: width 20, round cap, round join, miter 4; `Expand stroke…` uses `keepEditable: false`; `Offset Contour…` uses distance 10. The commands themselves take explicit arguments; only the menu path uses defaults. **Plan-time choice, easy to change.**

## Dependency graph

```
RemoveLiveStroke + live_stroke_contour_ids (shift-font)
  └─ EngineReads::live_stroke_contours (shift-wasm) ─► regenerate protocol
        └─ TS read: engineModule → SessionEngine → Font
LayerIntents + GlyphLayer methods ───────────────┐
availability function ◄── TS read ───────────────┤
stroke commands (matrix, one transaction) ◄──────┘
        └─ CommandId + main registry + menu + renderer routing + notify
```

## Tasks

### Phase 1: Rust

- [x] **T1. `RemoveLiveStroke` and `live_stroke_contour_ids`** (S)
  - Acceptance: removing clears the lib entry and keeps the contour; the `com.shift.stroke` key is dropped when empty; errors on a contour with no live entry; one undo restores it; `live_stroke_contour_ids` lists only Skeleton entries with a style and does not solve outlines.
  - Verify: `cargo test -p shift-font --lib stroke::`; `cargo clippy -p shift-font --all-targets`; `cargo fmt --check`.
  - Files: `stroke/live_stroke.rs`, `intents/layer_intents.rs`, `intents.rs`.
- [x] **T2. Engine read `live_stroke_contours` + TS read path** (M)
  - Acceptance: wasm read returns the dynamic contour ids for a layer; `session.font.liveStrokeContours(layerId)` returns them and re-runs reactive readers after `setLiveStroke`.
  - Verify: `cargo test -p shift-wasm --features engine stroke`; `pnpm build:wasm`; focused vitest in `packages/editor/src/lib/wasm/`.
  - Files: `shift-wasm/src/stroke_preview.rs`, `engine_reads.rs`, `editor/src/lib/wasm/engineModule.ts`, `engine/SessionEngine.ts`, `model/Font.ts`, `types/font.ts`.

**Checkpoint A:** Rust and wasm green, protocol regenerated, `RemoveLiveStroke` visible in `FontIntent`.

### Phase 2: Editor

- [x] **T3. Typed layer methods** (M)
  - Acceptance: `LayerIntents` and `GlyphLayer` have `setLiveStroke`, `bakeStrokeOutlines`, `outlineStroke`, `offsetContour`, `removeLiveStroke`; each applies and undoes in a `TestEditor`.
  - Verify: focused vitest on `Glyph`.
  - Files: `workspace/LayerIntents.ts`, `model/Glyph.ts`, `model/Glyph.test.ts`, types file.
- [x] **T4. Availability function** (S)
  - Acceptance: table-driven test over no selection, open vs closed, mixed, preview font, non-active source; every disabled case has a non-empty reason.
  - Files: `lib/commands/strokeAvailability.ts` (+ test), `types/stroke.ts`.
- [x] **T5. Stroke commands and the Expand matrix** (M)
  - Acceptance: the matrix above passes including one-undo for the two-intent case; refusal returns a reason and changes no state.
  - Files: `lib/commands/strokeCommands.ts` (+ test), `lib/commands/strokeMenuCommand.ts` (+ test).

**Checkpoint B:** editor-level behaviour proven in `TestEditor` before touching the app shell.

### Phase 3: App shell

- [x] **T6. Notification primitive** (S): `notify`, `AppNotifications`, mounted in `App.tsx`; test asserts `notify` delivers to a listener.
- [x] **T7. Register and route** (M): five `CommandId`s, main registry (workspace-level `enabled`), `rendererCommands.ts` routing, Glyph → Stroke submenu. Test: running an unavailable command through `runRendererCommand` notifies the reason and leaves the document unchanged.

### Phase 4: Done

- [x] **T8. Verification and docs** (S): `cargo fmt`, `cargo clippy`, `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`; mutation check on one availability condition; ROADMAP A3.1 command half; SPEC status; commit via the `commit` skill, excluding `crates/shift-bridge/index.js`, `explorations/ui-sound/`, `packages/wasm/src/generated-reference/`.

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| New `FontIntent` variant breaks exhaustive matches or the pack wire (store, CLI, bridge) | Med | Compile the workspace after T1; fix every match; run the wire consistency tests |
| Bake/Outline create new contour ids, leaving the selection stale | Low | Not in scope; note for the panel |
| Menu defaults surprise (destructive `Expand stroke…` default) | Low | One undo step; flagged above |
| Generated protocol files are gitignored and need `pnpm build:wasm` | Low | Run it after T2 before TS work |

## Findings during implementation

- **Baked and outlined strokes were stored as open contours.** kurbo ends the outline of an open skeleton on its start point with no `ClosePath`, and the existing Rust oracle only checked that the path closed geometrically, so `OutlineStroke`, `BakeStrokeOutlines` and the preview read all produced contours with `closed: false` and a repeated end point. A fill needs a closed contour. Fixed in Rust (`exact_offset::outline` closes returning subpaths; `Contours::from(&BezPath)` drops an end point that repeats the start at `ClosePath`), with tests at the path, contour and bake level.
- **No component test setup in the desktop app.** `AppNotifications` is covered by typecheck and lint, and `notify` by unit tests; the rendered toast has no test until the desktop gets a DOM test environment.

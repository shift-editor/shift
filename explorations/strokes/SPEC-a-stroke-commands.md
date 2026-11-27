# Spec: `a-stroke-commands`

**Branch:** `explore/strokes`  
**Module:** [SPEC-map.md](./SPEC-map.md) → `a-stroke-commands`  
**ROADMAP:** A3.1 (command half)  
**Last revised:** 2026-11-20 (Q-cmd-1..5 decided)  
**Status:** approved; implemented locally (see [PLAN-a-stroke-commands.md](./PLAN-a-stroke-commands.md)), awaiting local sign-off

## Verified starting point

Checked against the code on 2026-11-20, not taken from the roadmap:

| Fact                                                                                                                                                                                                                                                       | Where                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rust intents exist: `SetLiveStroke { layer_id, contour_ids, style }`, `BakeStrokeOutlines { layer_id, contour_ids, tolerance }`, `OutlineStroke { …, style, tolerance }`, `OffsetContour { layer_id, contour_id, distance, join, miter_limit, tolerance }` | `crates/shift-font/src/intents/layer_intents.rs`                                              |
| The wire already carries them (`kind: "setLiveStroke"` is used by `strokeOutlinePreviews.test.ts`)                                                                                                                                                         | `packages/editor/src/lib/wasm/strokeOutlinePreviews.test.ts`                                  |
| The editor has **no** typed methods for them. Existing intents get one method each in `LayerIntents`, wrapped by a `Glyph` layer method (`reverseContour`)                                                                                                 | `packages/editor/src/lib/workspace/LayerIntents.ts`, `packages/editor/src/lib/model/Glyph.ts` |
| **No** "remove dynamic stroke" intent exists in Rust (UX-spec marked it TBD)                                                                                                                                                                               | grep of `crates/` finds no `ClearLiveStroke` or `RemoveLiveStroke`                            |
| **No** cheap read answers "which selected contours are dynamic strokes". Only `stroke_outline_previews` reports skeletons, and it solves outlines to do so                                                                                                 | `crates/shift-wasm/src/stroke_preview.rs`                                                     |
| `CommandId` is a closed union in `apps/desktop/src/shared/commands.ts`; main registers commands in `apps/desktop/src/main/commands/Commands.ts`; renderer runs them in `rendererCommands.ts`                                                               | `apps/desktop/src/…`                                                                          |
| Main-process `enabled` is **workspace-level only** (`ctx.document.hasWorkspace()`). Selection-aware checks (`canMakeFirstPoint`) live in the renderer and **return false silently**                                                                        | `Commands.ts`, `rendererCommands.ts`                                                          |
| Selection-aware UI already exists in the renderer: `CanvasContextMenu.tsx`, right sidebar sections                                                                                                                                                         | `apps/desktop/src/renderer/src/components/editor/`                                            |

## ASSUMPTIONS I'M MAKING

1. **Rust owns every answer.** Whether a contour is a dynamic stroke is a font fact, so it is read from the engine. TypeScript does not parse `com.shift.stroke`.
2. **The Expand rule is decided** (UX-spec #10): checkbox off on a dynamic selection → `BakeStrokeOutlines`; on a fill-only selection → `OutlineStroke`; edited dialog fields on a dynamic selection → `SetLiveStroke` then `BakeStrokeOutlines` in one undo step.
3. **Commands act on the active source's editable layer**, like `reverseContours` (refuse when `layer.sourceId !== editor.activeSourceId` or the session is a preview).
4. **Style values come from the caller.** This module defines commands that take a style argument. Where the values come from (dialog, sidebar fields, defaults) belongs to `a-stroke-panel`.
5. **Defaults** are the Rust ones: round cap, round join, miter limit 4.0, tolerance 0.25.
6. **A "remove dynamic stroke" intent is added in Rust** (clear the lib entry, keep the contour). This is the only Rust change in the module.
7. **No chrome beyond registering menu entries.** Dialogs, the sidebar section and the context menu belong to `a-stroke-panel`.

Assumptions 1–7 stand. Q-cmd-1..5 are decided (see [Decisions](#decisions)).

## Objective

Make the stroke intents callable from the editor through one command surface, so the panel, the menu, keyboard shortcuts, tests and agents all use the same entry points and the same rules for when a command can run.

**Success looks like:** a test (and later a person) can select a contour, run `glyph.stroke.applyDynamic` with a style, see the preview read return an outline, run `glyph.stroke.expand`, and undo each step. A command that cannot run says why. It never does nothing silently.

**Users:** `a-stroke-panel` (every control), the app menu, agents through the command API, and `TestEditor` tests.

## The no-silent-failure rule

Tasos's requirement, made concrete. Every command has two layers of protection:

1. **Prevent at the choice point.** One pure function computes availability from the current selection and engine reads, and returns `{ enabled: true }` or `{ enabled: false, reason }`. Sidebar controls and the context menu call it and render disabled controls with the reason (tooltip or caption).
2. **Notify when prevention is impossible.** The native app menu is enabled at workspace level only, because main does not know the selection (decided Q-cmd-2: it stays that way in v1). If a menu command is invoked while unavailable, the renderer shows the same `reason` as a notification. It does not return `false` silently.

A command that is available but fails at apply time (engine error) also notifies, with the error. There is no path that ends in silence.

## Commands

IDs follow the `glyph.*` pattern already in `CommandId`.

| `CommandId`                    | Takes                       | Rust intent                                                                                                                  | Available when                          |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `glyph.stroke.applyDynamic`    | style                       | `SetLiveStroke`                                                                                                              | ≥1 contour selected, editable layer     |
| `glyph.stroke.expand`          | none                        | `BakeStrokeOutlines`                                                                                                         | ≥1 selected contour is a dynamic stroke |
| `glyph.stroke.expandWithStyle` | style, `keepEditable`       | `keepEditable` on → `SetLiveStroke`; off → `OutlineStroke` (fill-only) or [`SetLiveStroke` +] `BakeStrokeOutlines` (dynamic) | ≥1 contour selected, editable layer     |
| `glyph.stroke.offsetContour`   | distance, join, miter limit | `OffsetContour`                                                                                                              | exactly 1 **closed** contour selected   |
| `glyph.stroke.removeDynamic`   | none                        | new `RemoveLiveStroke`                                                                                                       | ≥1 selected contour is a dynamic stroke |

Notes:

- **Mixed selections (Q-cmd-4):** `expand` and `removeDynamic` act on the dynamic contours in the selection and leave the rest untouched. They are available whenever at least one selected contour is dynamic.
- **Already-dynamic selection with `keepEditable` on (Q-cmd-5):** `expandWithStyle` overwrites the stored style (`SetLiveStroke`). This is also how a style edit on a dynamic contour is applied.
- **No keyboard shortcuts in v1 (Q-cmd-3).**
- Commands that take arguments are exposed as typed editor methods and as `CommandId`s. Menu items for them open the dialog (`a-stroke-panel`); the dialog then calls the method.
- All five run inside one `editor.transaction(label, …)` so each is one undo step, including the two-intent Expand case.
- Labels use the UX-spec copy: "Apply dynamic stroke…", "Expand stroke…", "Expand stroke", "Offset Contour…", "Remove dynamic stroke".

## Project structure

| Path                                                                                                             | Change                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/shift-font/src/intents/layer_intents.rs`, `stroke/layer_lib.rs`                                          | **Add** `RemoveLiveStroke` intent + lib-entry removal                                                                                                                                                                                                   |
| `crates/shift-font/src/stroke/`                                                                                  | **Add** a read that lists which of a set of contours are dynamic strokes (no outline solve)                                                                                                                                                             |
| `crates/shift-wasm/src/`                                                                                         | Expose that read; regenerate layouts with `pnpm generate:from-rust`                                                                                                                                                                                     |
| `packages/editor/src/lib/workspace/LayerIntents.ts`                                                              | **Add** typed methods for the five intents                                                                                                                                                                                                              |
| `packages/editor/src/lib/model/Glyph.ts`                                                                         | **Add** layer methods wrapping them, matching `reverseContour`                                                                                                                                                                                          |
| `packages/editor/src/lib/commands/` (new `strokeCommands.ts` next to the editor, exact home chosen at plan time) | Availability function and command bodies                                                                                                                                                                                                                |
| `apps/desktop/src/shared/commands.ts`                                                                            | **Add** the five `CommandId`s                                                                                                                                                                                                                           |
| `apps/desktop/src/main/commands/Commands.ts`                                                                     | **Register** them (workspace-level `enabled`)                                                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/lib/commands/rendererCommands.ts`                                                 | **Route** them to the editor commands                                                                                                                                                                                                                   |
| `apps/desktop/src/main/menu/ApplicationMenu.ts`                                                                  | **Add** the Glyph → Stroke submenu (items only; dialogs come later)                                                                                                                                                                                     |
| `apps/desktop/src/renderer/src/components/chrome/` and `app/App.tsx`                                             | **Add** a minimal app-level notification (Q-cmd-1): one `ToastProvider` + viewport from `@shift/ui` mounted in `App`, and a small `notify(message)` the renderer commands call. Separate from `ZoomToast` and `GridToasts`, which stay surface-specific |

## Commands (shell)

```bash
# Rust: new intent and read
nix develop --command cargo test -p shift-font --lib stroke::
nix develop --command cargo test -p shift-wasm --features engine stroke
nix develop --command cargo clippy -p shift-font -p shift-wasm --all-targets
nix develop --command cargo fmt --check

# Regenerate layouts and bridge types after Rust changes
nix develop --command pnpm generate:from-rust
nix develop --command pnpm generate:bridge-types
nix develop --command pnpm build:wasm

# TypeScript
nix develop --command pnpm test:desktop apps/desktop/src/renderer/src/lib/commands/rendererCommands.test.ts
nix develop --command pnpm test:desktop packages/editor/src/lib/commands
nix develop --command pnpm typecheck
nix develop --command pnpm lint:check
nix develop --command pnpm format:check
```

## Code style

Follow [AGENTS.md](../../AGENTS.md). One real pattern to copy: a command that edits as one undoable step and refuses when it cannot resolve a layer (`reverseContours` in `rendererCommands.ts`):

```ts
export function reverseContours(editor: Editor, contourIds: Iterable<ContourId>): boolean {
  const contours = [...contourIds]
    .map((contourId) => editor.object(contourId))
    .filter((object) => objectIsKindOf(object, "contour"));

  if (contours.length === 0) return false;

  const layer = editor.layerForGeometry({ contours: contours.map((contour) => contour.contourId) });
  if (!layer || layer.sourceId !== editor.activeSourceId) return false;

  editor.transaction("Reverse Contours", () => {
    for (const contour of contours) layer.reverseContour(contour.contourId);
  });

  return true;
}
```

Differences the stroke commands must make from this pattern:

- Return a result that carries the **reason** on refusal, not a bare `false`.
- Early returns for guards, blank lines between logical blocks, named intermediate values, no nested ternaries.
- Style arguments typed with a named domain type (no inline `Pick`/`Omit`), `Point2D` where geometry is passed.
- No Manager, Store or Cache wrappers. Availability is a pure function, not a class.

## Testing strategy

Per [/writing-tests](../../.agents/skills/writing-tests/SKILL.md): `TestEditor` with a real engine, assert on state, not mock calls.

| Concern                                                                     | Level                               | Approach                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RemoveLiveStroke` clears the entry and keeps the contour; undo restores it | Rust unit + `layer_edit` style test | Beside the existing `live_stroke` tests                                                                                                                               |
| "Is dynamic stroke" read                                                    | Rust unit + wasm test               | Returns exactly the contours with a lib entry; does not solve outlines                                                                                                |
| Each command applies and undoes                                             | `TestEditor`                        | `applyDynamic` then `strokeOutlinePreviews` is non-empty; `expand` leaves fills and no preview; one `undo` restores the prior state                                   |
| Expand matrix                                                               | `TestEditor`                        | fill-only + off → fills, no lib entry; dynamic + off → fills, no lib entry; edited fields on dynamic → baked at the _new_ width; one undo restores the original       |
| Availability                                                                | Unit on the pure function           | Table-driven: no selection, open vs closed contour, mixed dynamic/fill selection, preview session, non-active source. Each disabled case asserts a non-empty `reason` |
| No silent failure                                                           | `TestEditor`                        | Running an unavailable command via `runRendererCommand` produces a notification carrying the reason and changes no document state                                     |
| Mutation check                                                              | Manual before done                  | Invert one availability condition, confirm a test fails                                                                                                               |

**Not in this module:** E2E tests and visual goldens (they belong to `a-stroke-panel`).

## Boundaries

### Always

- Rust owns the answers: new facts about strokes come from a Rust read, never a TypeScript parse of lib data.
- One undo step per command, including multi-intent commands.
- A refusal always carries a reason that reaches the user.
- Run the shell commands above before claiming done. Keep `cargo clippy` clean (it is clean now).

### Ask first

- Any new `FontIntent` discriminant beyond `RemoveLiveStroke`, or changes to pack layouts for existing intents.
- Anything beyond the minimal notification (queueing, actions, severity styles, persistence).
- Changing `CommandId` naming beyond `glyph.stroke.*`.

### Never

- Dialogs, the sidebar Stroke section, canvas context menu entries, or any UI beyond menu items (`a-stroke-panel`).
- A TypeScript stroke or offset solver, or a TypeScript copy of the Expand rule's geometry.
- Silent `return false` for a refusal.
- Touch `explorations/ui-sound`, `crates/shift-bridge/index.js`, or `packages/wasm/src/generated-reference/`.

## Success criteria

1. `RemoveLiveStroke` exists in Rust with tests; the dynamic-stroke read exists in Rust and wasm with tests and does not solve outlines.
2. `LayerIntents` and `Glyph` have typed methods for all five operations; `TestEditor` can run each.
3. Five `glyph.stroke.*` commands are registered in `CommandId`, main, and `rendererCommands.ts`; the Glyph → Stroke submenu lists them.
4. The Expand matrix in the testing table passes, including one-undo behaviour for the two-intent case.
5. The availability function has a table-driven test; every disabled case returns a reason.
6. Invoking an unavailable command from the menu path shows a notification with the reason and leaves the document unchanged (asserted in a test).
7. `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `cargo clippy --all-targets` and `cargo fmt --check` pass; existing `shift-font` stroke tests stay green.
8. `explorations/strokes/ROADMAP.md` A3.1 is updated to reflect the command half done (the UI half stays open).

**Reframed vague goal:** "make the intents reachable" → criteria 2–3. "No silent failures" → criteria 5–6.

## Decisions

Decided by Tasos, 2026-11-20.

| #       | Question                                                            | Decision                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-cmd-1 | Notification primitive                                              | `@shift/ui` already wraps Base UI Toast, but `ZoomToast` and `GridToasts` are tied to their own surfaces. Add a **minimal app-level notification** in this module: one provider and viewport mounted in `App`, plus a small `notify(message)`. |
| Q-cmd-2 | Grey native menu items by selection?                                | **No.** Items stay enabled at workspace level; invoking an unavailable one shows the reason as a notification.                                                                                                                                 |
| Q-cmd-3 | Keyboard shortcuts                                                  | **None in v1.**                                                                                                                                                                                                                                |
| Q-cmd-4 | Mixed selection for `expand` / `removeDynamic`                      | **Act on the dynamic contours**, leave the rest untouched.                                                                                                                                                                                     |
| Q-cmd-5 | `expandWithStyle` with `keepEditable` on, selection already dynamic | **Overwrite** the stored style (`SetLiveStroke`).                                                                                                                                                                                              |

## Open questions

None blocking. Plan-time choices (not decisions for this spec): exact home of `strokeCommands.ts`, and the wire shape of the "which contours are dynamic" read.

## Related documents

- [UX-spec.md](./UX-spec.md): names, entry points, intent mapping, #10 resolution
- [SPEC-map.md](./SPEC-map.md): direction and build order
- [ROADMAP.md](./ROADMAP.md): A3.1, A3.2 follow-ups
- [README-dev.md](./README-dev.md): CLI path for manual QA

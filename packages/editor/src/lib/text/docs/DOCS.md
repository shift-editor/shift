# Text

<!-- reviewed: 2026-10-04 review-every: 90d -->

Proof text is document-scoped item content projected through one implicit page run, edited by one session caret, with the edited glyph placed inside the run.

## Architecture Invariants

- `TextRunRecord.items` stores stable, client-minted `TextItemId` identities for glyphs and linebreaks. Indices/clusters are derived, never identity. `/name` parsing belongs to paste/import, not the stored representation.
- Until pages exist, the canvas has one run. The desktop editor route creates it at the scene origin on the first open and replaces its text with each glyph opened from the grid; that interim policy lives in the route, not the editor package. Users never place runs and the Text tool never creates one.
- The edited glyph is the run's child `GlyphNode { parentId: run, itemId }`. `TextRunNodeDefinition.childPosition` places it at its item's layout position, and the run skips drawing items a child occupies. A run has at most one child; switching replaces it (delete + create) so per-node caches never see a node change glyph.
- `Text` owns records and layout only. `TextRunNodeDefinition` owns the run's child: it places it (`childPosition`), skips its item, switches it (`editItem`, also from `onDoubleClick`), and deletes it when its item leaves the run (`onContentChange`, run when the capture finishes, whoever removed the item), so undo restores an item and its child together.
- `Text.layoutCell(runId)` is the shared reactive layout, derived from items, source, axis location, completed glyph acquisition, and each laid-out glyph's advance. A missing glyph is loaded asynchronously; no layout or draw path starts I/O. Even an empty run has a caret at its origin.
- `TextEditingRecord` owns the current node, anchor, and focus for one session. A `TextCaret` is the ID of the preceding item or null for the run start. Its cluster is `indexOf(itemId) + 1`; linebreaks count. Vertical goal-x is transient.
- Text mode suspends glyph editing (`Editing.suspend`), so every glyph draws filled, and restores it on exit. Leaving Text mode keeps the `TextEditingRecord` with `active: false`, so the next visit resumes the caret and selection; `TextEditing.stateCell` only exposes an active record. Undo outside Text mode restores the record inactive.
- Two hit paths, never mixed: `TextRunNodeDefinition.hit` returns a text target only on a glyph's outline (fill or contour within hit radius), used by Select hover, click-select, and double-click. `TextRunNodeDefinition.caretAt` returns the nearest caret cluster in the line boxes and is called by the Text tool directly. Node definitions never branch on the active tool.
- `TextItemId` is a selectable `ShiftId`: `Editor.object` resolves it to a `textItem` object, and hover/selection go through `editor.hover` / `editor.selection`. Text items report no bounds, so they never get the transform box.
- `EditorHistory` captures complete text-run, node, and session-record replacements, never a second text undo stack. Entering or switching the edited glyph is its own undo step; plain selection is not.

## Key Types

- `TextItemId` — stable branded identity of one glyph or linebreak item; also a selectable id.
- `TextCaret` — ID of the preceding item, or null at the run start.
- `TextRunRecord` — document-scoped item content; `TextRunNode` — its placed occurrence.
- `PlacedGlyph` — a positioned glyph with its layout-local origin; `TextLayout.placedGlyphs` is the one walk over lines and runs.
- `TextEditingRecord` — session-only node, anchor, and focus.
- `TextLayout` and `Caret` — derived geometry and cluster-based navigation.

## Codemap

- `Text.ts`: run records, imported text parser, reactive layout, glyph acquisition.
- `TextEditing.ts`: session caret, navigation, selected items, history boundaries.
- `edit.ts`: pure splice, deletion, selection, word, and selection-rectangle operations.
- `layout/`: TextLayout, Positioner (literal LTR advances), and Caret.
- `apps/desktop/src/renderer/src/views/Editor.tsx`: the interim one-run open policy.
- `lib/nodes/TextRunNodeDefinition.ts`: scaled presentation, child placement, outline hits, caret lookup.
- `lib/objects/TextItemObject.ts`: resolved object for a selected or hovered item.
- `lib/tools/text/`: Text mode and caret gestures.
- `lib/tools/select/behaviors/NodeDoubleClick.ts`: Select offers double-clicks to the hit node's definition and its ancestors'.
- `apps/desktop/src/renderer/src/components/text/HiddenTextInput.tsx`: native text and keyboard adapter; owns Undo/Redo while focused because the global keyboard router deliberately ignores editable fields.

## How it works

Pointer actions use `ToolManager`'s click/drag history capture. Keyboard edits capture a replacement run record and the session caret together. `ShiftStore.onChange` notifies only the edited run's layout cell; changing the caret record does not rebuild layout. Missing glyphs load asynchronously and bump a layout version once available. Node definitions read snapshots during draw; background and scene layer props declare reactive redraw dependencies.

## Workflow recipes

To add a text command, translate the current stable caret to a cluster, perform a pure item edit, then write the run and the session record inside `EditorHistory.captureOrJoin`, which joins ToolManager's pointer capture or opens one for keyboard edits.

To change which glyph is edited, call `TextRunNodeDefinition.editItem(run, itemId)` and `Editor.enterNode` inside one history capture. To add a glyph first, use `Text.insertAfter`.

## Gotchas

Empty runs have no `TextLayout.lines`, but still need a visible caret and a small caret area. Child placement tracks the run layout only when read inside a reactive boundary; imperative reads see the current layout. Linebreaks consume clusters and can be selected despite not producing a positioned glyph. `ShiftStore.cell` is whole-map reactive: do not read it in `layoutCell`, or caret changes will rebuild every run.

## Legacy test migration ledger

Every row names a removed or rewritten test from the legacy suites or toolbar E2E. Their original source remains in git history.

| Removed test                                               | Protected truth                                | Replacement or intentionally removed behavior                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TextBuffer: starts empty                                   | Empty content, no selection at start           | `edit.test.ts`: starts with an empty selection; `TextEditing.test.ts`: entering Text mode puts the caret after the edited glyph  |
| TextBuffer: insert places item at cursor                   | Insert and collapse after new item             | `edit.test.ts`: insertion advances both carets                                                                                   |
| TextBuffer: insert replaces an active selection            | Splice selected interval, collapse caret       | `edit.test.ts`: replaces a forward or backward selection                                                                         |
| TextBuffer: delete removes item before cursor              | Backspace removes preceding item               | `edit.test.ts`: backspace removes the preceding item                                                                             |
| TextBuffer: delete at buffer start                         | No-op at start                                 | `edit.test.ts`: backspace at the beginning                                                                                       |
| TextBuffer: delete with active selection                   | Selected deletion and collapse to start        | `edit.test.ts`: deletion of selected items                                                                                       |
| TextBuffer: selectAll spans 0..length                      | Full item range, including linebreaks          | `edit.test.ts`: select-all spans the item buffer; `TextEditing.test.ts`: selection history                                       |
| TextBuffer: placeCaret clamps                              | Clamp and collapse                             | `edit.test.ts`: caret placement clamps; `tools/text/Text.test.ts`: clicking a glyph in the run places the caret                  |
| TextBuffer: snapshot then restore                          | Content and caret restore together             | `TextEditing.test.ts`: inserts text and replays content and caret. `originX` is intentionally removed with drawOffset            |
| TextBuffer: itemById follows logical item                  | IDs survive moves and vanish on deletion       | `edit.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: starts with everything null               | No active interaction at start                 | `TextEditing.test.ts`: entering and leaving Text mode                                                                            |
| TextInteraction: setEditing stores target                  | In-place glyph target by index                 | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                      |
| TextInteraction: suspend moves editing                     | Suspend in-place glyph target across tool exit | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                      |
| TextInteraction: resume restores suspended target          | Resume in-place glyph target                   | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                      |
| TextInteraction: resume with nothing                       | No suspended glyph target                      | Intentionally removed along with suspension                                                                                      |
| TextInteraction: clear resets context                      | End focus and clear hover                      | `TextEditing.test.ts`: leaving Text mode ends text editing; run hover is Select's outline hover                                  |
| TextInteraction: adjust nulls deleted indices              | Deleted glyph target no longer resolves        | `edit.test.ts`: an item identity follows insertion/deletion (absent ID resolves to no cluster); in-context target owner deferred |
| TextInteraction: adjust shifts after deletion              | Surviving identity follows reordered items     | `edit.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: adjust shifts after insertion             | Surviving identity follows reordered items     | `TextEditing.test.ts`: a caret stays on its item when another is inserted before it                                              |
| TextInteraction: snapshot then restore                     | Transient context round-trips                  | `TextEditing.test.ts`: inserts text and replays content and caret; suspended glyph target intentionally removed                  |
| Text tool: publishes typing until Escape returns to Select | Active text tool escapes to Select             | `tools/text/Text.test.ts`: starts editing and returns to Select on Escape                                                        |
| E2E tools: hides unavailable tools                         | Text tool hidden before rebuild                | Intentionally replaced by `tools.spec.ts`: text shortcut activates the toolbar and native input; text tool is now available      |

## Verification

`pnpm test:desktop src/renderer/src/lib/text` covers layout, pure edits, and real-editor interactions. Also run `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `pnpm check:browser`, and `python3 scripts/context-drift-check.py`. Manual desktop verification must cover typing, selection, undo, Escape, axis scrubbing, opening glyphs from the grid, and double-clicking run glyphs and components.

## Related

- [`Editor`](../../editor/docs/DOCS.md) — record history, scene placement, and renderer ownership.
- [`Tools`](../../tools/docs/DOCS.md) — text tool states and pointer capture lifecycle.
- [`Signals`](../../signals/docs/DOCS.md) — per-run reactive invalidation.

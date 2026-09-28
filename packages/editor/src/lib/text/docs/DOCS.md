# Text

<!-- reviewed: 2026-09-28 review-every: 90d -->

Placed proof text is document-scoped item content projected through scene nodes and edited by one session caret.

## Architecture Invariants

- `TextRunRecord.items` stores stable, client-minted `TextItemId` identities for glyphs and linebreaks. Indices/clusters are derived, never identity. `/name` parsing belongs to paste/import, not the stored representation.
- `Scene` owns placement and ordering; `TextRunNode.runId` links it to a run. `size / unitsPerEm` scales node-local layout equally for bounds, hits, and all drawing passes. Location follows the editor, not the node.
- `Text.layoutCell(runId)` is the shared reactive layout, derived from items, source, axis location, and completed glyph acquisition. A missing glyph is loaded asynchronously; no layout or draw path starts I/O. Even an empty run has a caret at its origin.
- `TextEditingRecord` owns the current node, anchor, and focus for one session. A `TextCaret` is the ID of the preceding item or null for the run start. Its cluster is `indexOf(itemId) + 1`; linebreaks count. Hover and vertical goal-x are transient.
- `TextRunNodeDefinition` draws selection in background, fills/hover in content, and caret in controls. Hits return a text target with node-local point, item identity, and insertion cluster. The renderer enters node space once; the definition applies size scale.
- `EditorHistory` captures complete text-run, node, and session-record replacements, never a second text undo stack. Replays place the session record last and reject dangling text node/run identities. Ending text focus when switching tools is transient; Escape's empty-run deletion is one separate undoable action. Undo of that deletion restores the node without reopening editing.
- No draw offset or implicit editor run exists. In-context glyph editing will use a child GlyphNode in a later slice.

## Key Types

- `TextItemId` — stable branded identity of one glyph or linebreak item.
- `TextCaret` — ID of the preceding item, or null at the run start.
- `TextRunRecord` — document-scoped item content; `TextRunNode` — its placed occurrence.
- `TextEditingRecord` — session-only node, anchor, and focus.
- `TextLayout` and `Caret` — derived geometry and cluster-based navigation.

## Codemap

- `Text.ts`: run records, imported text parser, reactive layout, glyph acquisition.
- `TextEditing.ts`: session caret, navigation, selected items, history boundaries, hover.
- `edit.ts`: pure splice, deletion, selection, word, and selection-rectangle operations.
- `layout/`: existing TextLayout, Positioner (literal LTR advances), and Caret.
- `lib/nodes/TextRunNodeDefinition.ts`: scaled presentation and hit testing.
- `lib/tools/text/`: ready/editing tool states and canvas gestures.
- `apps/desktop/src/renderer/src/components/text/HiddenTextInput.tsx`: native text and keyboard adapter; owns Undo/Redo while focused because the global keyboard router deliberately ignores editable fields.

## How it works

Pointer actions use `ToolManager`'s click/drag history capture. Keyboard edits capture a replacement run record and the session caret together. `ShiftStore.onChange` notifies only the edited run's layout cell; changing the caret record does not rebuild layout. Missing glyphs load asynchronously and bump a layout version once available. Node definitions read snapshots during draw; background and scene layer props declare reactive redraw dependencies.

## Workflow recipes

To add a text command, translate the current stable caret to a cluster, perform a pure item edit, then capture the run and session record replacements in the same history action. For pointer interactions, use the capture already opened by ToolManager.

## Gotchas

Empty runs have no `TextLayout.lines`, but still need a visible caret and a small hit area. Linebreaks consume clusters and can be selected despite not producing a positioned glyph. `ShiftStore.cell` is whole-map reactive: do not read it in `layoutCell`, or caret changes will rebuild every run.

## Legacy test migration ledger

Every row names a removed or rewritten test from the legacy suites or toolbar E2E. Their original source remains in git history.

| Removed test                                               | Protected truth                                | Replacement or intentionally removed behavior                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TextBuffer: starts empty                                   | Empty content, no selection at start           | `edit.test.ts`: starts with an empty selection; `TextEditing.test.ts`: click creates an empty node                               |
| TextBuffer: insert places item at cursor                   | Insert and collapse after new item             | `edit.test.ts`: insertion advances both carets                                                                                   |
| TextBuffer: insert replaces an active selection            | Splice selected interval, collapse caret       | `edit.test.ts`: replaces a forward or backward selection                                                                         |
| TextBuffer: delete removes item before cursor              | Backspace removes preceding item               | `edit.test.ts`: backspace removes the preceding item                                                                             |
| TextBuffer: delete at buffer start                         | No-op at start                                 | `edit.test.ts`: backspace at the beginning                                                                                       |
| TextBuffer: delete with active selection                   | Selected deletion and collapse to start        | `edit.test.ts`: deletion of selected items                                                                                       |
| TextBuffer: selectAll spans 0..length                      | Full item range, including linebreaks          | `edit.test.ts`: select-all spans the item buffer; `TextEditing.test.ts`: selection history                                       |
| TextBuffer: placeCaret clamps                              | Clamp and collapse                             | `edit.test.ts`: caret placement clamps; `TextEditing.test.ts`: click creates caret                                               |
| TextBuffer: snapshot then restore                          | Content and caret restore together             | `TextEditing.test.ts`: inserts text and replays content and caret. `originX` is intentionally removed with drawOffset            |
| TextBuffer: itemById follows logical item                  | IDs survive moves and vanish on deletion       | `edit.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: starts with everything null               | No active interaction at start                 | `TextEditing.test.ts`: click creates an editing session; initial session absent outside text editing                             |
| TextInteraction: setEditing stores target                  | In-place glyph target by index                 | Intentionally removed in slice 1; in-context glyph editing is deferred                                                           |
| TextInteraction: suspend moves editing                     | Suspend in-place glyph target across tool exit | Intentionally removed in slice 1; in-context glyph editing is deferred                                                           |
| TextInteraction: resume restores suspended target          | Resume in-place glyph target                   | Intentionally removed in slice 1; in-context glyph editing is deferred                                                           |
| TextInteraction: resume with nothing                       | No suspended glyph target                      | Intentionally removed along with suspension                                                                                      |
| TextInteraction: clear resets context                      | End focus and clear hover                      | `TextEditing.test.ts`: Escape deletes an empty node; hover follows item and clears                                               |
| TextInteraction: adjust nulls deleted indices              | Deleted glyph target no longer resolves        | `edit.test.ts`: an item identity follows insertion/deletion (absent ID resolves to no cluster); in-context target owner deferred |
| TextInteraction: adjust shifts after deletion              | Surviving identity follows reordered items     | `edit.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: adjust shifts after insertion             | Surviving identity follows reordered items     | `TextEditing.test.ts`: a caret stays on its item when another is inserted before it                                              |
| TextInteraction: snapshot then restore                     | Transient context round-trips                  | `TextEditing.test.ts`: inserts text and replays content and caret; suspended glyph target intentionally removed                  |
| Text tool: publishes typing until Escape returns to Select | Active text tool escapes to Select             | `tools/text/Text.test.ts`: starts ready and returns to Select; `typing` intentionally replaced with ready/editing                |
| E2E tools: hides unavailable tools                         | Text tool hidden before rebuild                | Intentionally replaced by `tools.spec.ts`: text shortcut activates the toolbar and native input; text tool is now available      |

## Verification

`pnpm test:desktop src/renderer/src/lib/text` covers layout, pure edits, and real-editor interactions. Also run `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `pnpm check:browser`, and `python3 scripts/context-drift-check.py`. Manual desktop verification must cover typing, selection, undo, Escape, and axis scrubbing.

## Related

- [`Editor`](../../editor/docs/DOCS.md) — record history, scene placement, and renderer ownership.
- [`Tools`](../../tools/docs/DOCS.md) — text tool states and pointer capture lifecycle.
- [`Signals`](../../signals/docs/DOCS.md) — per-run reactive invalidation.

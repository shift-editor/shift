# Text

<!-- reviewed: 2026-11-01 review-every: 90d -->

Proof text is document-scoped item content projected through one run per page, edited by one session caret, with the edited glyph placed inside the run.

## Architecture Invariants

- A run's items live in its text run node in the document's scene (shift-engine's `NodeContent::TextRun`, glyphs by `GlyphId`); `Scene.run(runId)` reads them as a `TextRunRecord`, keeping its identity while they are unchanged, and `Text.setItems` writes them as one `setRunItems` intent. `TextRunRecord.items` stores stable, client-minted `TextItemId` identities for glyphs and linebreaks. Indices/clusters are derived, never identity. The `/name` syntax of pasted and copied text belongs to shift-font's `ProofText` (the Glyphs rule: a name ends at a space it consumes or at the next `/`, `//` is a slash), called through `@shift/wasm`'s `proofTexts`; it is not the stored representation, and TypeScript keeps no parser of its own. `Text.itemsFromText` reads pasted text leniently (an unknown name, or text that is not proof text, stays as characters); `Text.parseText` reads it strictly, returning each `/name` the font lacks (`ParsedText.unknownGlyphNames`); `Text.formatItems` writes items back, for copy and for agents' readback. Typing is literal (`typedTextItems`).
- Each page has at most one run, at its origin. Opening a glyph from the grid (`Editor.openGlyphInText`, used by the desktop editor route, window tabs and `TestEditor`) shows the page, creates its run on the first open there and replaces its text with that glyph. Runs on other pages keep their text. Users never place runs and the Text tool never creates one except an empty, provisional one on a page with none (`Text.placeRun`). Agents add runs with `Text.addRun`, one undo step holding its items, never provisional.
- The edited glyph is the run's child `GlyphNode { parentId: run, itemId }`. `TextRunNodeDefinition.childPlacement` places it at its item's layout position and the run's size, and the run skips drawing items a child occupies. A run has at most one child; switching replaces it (delete + create) so per-node caches never see a node change glyph.
- `Text` owns run content and layout only. `TextRunNodeDefinition` owns the run's child: it places it (`childPlacement`), skips its item, switches it (`editItem`, also from `onDoubleClick`), and deletes it when its item leaves the run (`onContentChange`, run when the capture finishes, whoever removed the item), so undo restores an item and its child together.
- `Text.layoutCell(runId)` is the shared reactive layout, owned by one `RunText`. Every layout rule runs in Rust: `RunText` asks the window's engine to lay the run out, its items and settings as the scene stores them, from which Rust builds the layout options (`TextRun::layout_request`: a forced feature on or off, the line height, the alignment) (`Font.layoutText`, `EngineReads.layoutText`, shift-text's layout over the engine's own font, unsaved edits and a drag frame under way included), which shapes, positions kerning, marks and cursive joins at the font's insert markers, breaks lines, orders bidi runs and places caret stops, and `TextLayout` only indexes the result for drawing, hits, carets and selection. The read tracks the revision of each change flag layout reads (`FontEngine.layoutInputs`), the location, the source and glyph loads; a result that places everything as before keeps the layout, so an edit that moves nothing (an anchor no mark uses, a point) rebuilds nothing drawn from it. A drag frame the editor draws itself is shown in text through `GlyphLayer.previewInText` (`FontEngine.showPreview`), ended with the gesture (`endPreview`). The layout read is pure: glyphs it showed that the engine has not loaded come back in `PlacedText.unloaded`, and `RunText`'s reporting effect, not the computed, loads them into the engine (`Font.preloadLaidOut`), once each, and the layout reads again; `Text` loads them into the model too and logs, once, why text laid out unshaped. A window with no engine, such as a preview's, has shift-text lay its text out as typed too (`TypedText.layoutTyped` in the engine module, over each glyph's advance and mark class), once the effect has loaded that module; nothing lays text out in TypeScript. Even an empty run has a caret at its origin.
- `TextEditingRecord` owns the current node, anchor, and focus for one session. A `TextCaret` is the ID of the preceding item or null for the run start. Its cluster is `indexOf(itemId) + 1`; linebreaks count. Vertical goal-x is transient. `TextEditing.placeIn(node, focus, anchor)` places the caret and selection by cluster, as an agent does, and is never an undo step.
- Escape in Select steps out one level: deselect, then collapse to one source, then leave the edited glyph (`Editor.exitNodes`, its own undo step). A child that is not edited is plain text: the run draws and hits it like any other item, so it outlines on hover, exposes no contours, and double-clicking re-enters it. With nothing edited, select-all selects every run glyph, and a marquee selects the glyphs whose outline box it touches (`TextRunNodeDefinition.selectableInRect`).
- Text mode suspends glyph editing (`Editing.suspend`), so every glyph draws filled, and restores it on exit. Leaving Text mode keeps the `TextEditingRecord` with `active: false`, so the next visit resumes the caret and selection; `TextEditing.stateCell` only exposes an active record. Undo outside Text mode restores the record inactive.
- Two hit paths, never mixed: `TextRunNodeDefinition.hit` returns a text target only on a glyph's outline (fill or contour within hit radius), used by Select hover, click-select, and double-click. `TextRunNodeDefinition.caretAt` returns the nearest caret cluster in the line boxes and is called by the Text tool directly. Node definitions never branch on the active tool.
- Spacing gaps are run queries, like caret lookup: `spacingGapAt`, `spacingGapBetween`, and `spacingGaps` measure from the layout and each glyph's live outline on every call and store nothing, so they follow edits without invalidation. A gap spans both outline edges and both advance boundaries, so negative sidebearings stay inside it. Each sidebearing is measured to its own glyph's advance edge (`leftBoundary`, `rightBoundary`); the distance between the two is the pair's kerning, which belongs to neither sidebearing.
- Kerning, mark attachment and cursive joins are shift-font's `RunPositioning`, run inside shaping at each generated feature's insert marker and checked against the exported font (`shift-backends/tests/text_layout_export.rs`). A glyph reports its kerning apart from its advance (`PositionedGlyph.xKern`, the space after it on screen); every glyph keeps the advance shaping gave it, so a mark nothing attached sets as export sets it (a `GDEF` mark at none, a zero-width glyph at zero), and only text laid out as typed gives a zero-width mark a 600-unit stand-in.
- `TextItemId` is a selectable `ShiftId`: `Editor.object` resolves it to a `textItem` object, and hover/selection go through `editor.hover` / `editor.selection`. Text items report their outline bounds (`TextRunNodeDefinition.itemBounds`) and `TextRunNodeDefinition.transformTarget` makes them transform whole at the active source, each distinct glyph once (`GlyphsTransform`, one `GlyphTransformEdit` per glyph, committed through the one-intent `GlyphLayer.transformLayer`): each glyph pivots on its own bounds, the outline lands where the box shows, move and rotate keep the advance, and scale keeps the right sidebearing. Components built on another transformed glyph follow it instead of transforming twice.
- A run's content and nodes are document edits in the engine's one history; `EditorHistory` captures the session caret beside them, never a second text undo stack. Entering or switching the edited glyph is its own undo step; plain selection is not.

## Key Types

- `TextItemId` — stable branded identity of one glyph or linebreak item; also a selectable id.
- `TextCaret` — ID of the preceding item, or null at the run start.
- `TextRunRecord` — a run's items as `Scene.run` reads them from its node; `TextRunNode` — the node that holds them.
- `PlacedGlyph` — a positioned glyph with its layout-local origin; `TextLayout.placedGlyphs` is the one walk over lines and runs.
- `TextEditingRecord` — session-only node, anchor, and focus.
- `TextLayout` and `Caret` — derived geometry and cluster-based navigation.

## Codemap

- `Text.ts`: run content over the scene, proof text in and out (through shift-font's `ProofText`), per-run `RunText`, glyph acquisition.
- `RunText.ts`: one run's layout request and reactive layout.
- `TextEditing.ts`: session caret, navigation, selected items, history boundaries.
- `TextBuffer.ts`: immutable items-plus-selection value for splice, deletion, and grapheme and word steps.
- `layout/`: TextLayout (an index over the Rust layout, including selection rectangles) and Caret.
- `apps/desktop/src/renderer/src/lib/editor/openGlyph.ts`: the interim one-run-per-page open policy, called by `views/Editor.tsx`.
- `lib/nodes/TextRunNodeDefinition.ts`: scaled presentation, child placement, outline hits, caret lookup, spacing gaps.
- `lib/objects/TextItemObject.ts`: resolved object for a selected or hovered item.
- `lib/tools/text/`: Text mode and caret gestures.
- `lib/tools/select/behaviors/NodeDoubleClick.ts`: Select offers double-clicks to the hit node's definition and its ancestors'.
- `apps/desktop/src/renderer/src/components/text/HiddenTextInput.tsx`: native text and keyboard adapter; owns Undo/Redo while focused because the global keyboard router deliberately ignores editable fields.

## How it works

Pointer actions use `ToolManager`'s click/drag history capture. Keyboard edits capture a replacement run record and the session caret together. `Scene.run` notifies only the edited run's layout cell; changing the caret record does not rebuild layout. Missing glyphs load asynchronously and bump a layout version once available. Node definitions read snapshots during draw; background and scene layer props declare reactive redraw dependencies. A run's occurrences of one glyph share its render model, so `TextRunNodeDefinition` resolves and subscribes to each distinct glyph once per draw or hit test and spends only a translate and fill per occurrence; outline hits skip glyphs whose bounds, grown by the hit radius, miss the point. `apps/desktop/src/renderer/src/perf/textRunDraw.bench.ts` and `apps/desktop/e2e/text-run-perf.spec.ts` measure both at proof scale.

## Workflow recipes

To add a text command, translate the current stable caret to a cluster, perform a pure item edit, then write the run and the session record inside `EditorHistory.captureOrJoin`, which joins ToolManager's pointer capture or opens one for keyboard edits.

To change which glyph is edited, call `TextRunNodeDefinition.editItem(run, itemId)` and `Editor.enterNode` inside one history capture. To add a glyph first, use `Text.insertAfter`.

## Gotchas

Empty runs have no `TextLayout.lines`, but still need a visible caret and a small caret area. Child placement tracks the run layout only when read inside a reactive boundary; imperative reads see the current layout. Linebreaks consume clusters and can be selected despite not producing a positioned glyph. `ShiftStore.cell` is whole-map reactive: do not read it in `layoutCell`, or caret changes will rebuild every run.

## Legacy test migration ledger

Every row names a removed or rewritten test from the legacy suites or toolbar E2E. Their original source remains in git history.

| Removed test                                               | Protected truth                                | Replacement or intentionally removed behavior                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| TextBuffer: starts empty                                   | Empty content, no selection at start           | `TextBuffer.test.ts`: starts with an empty selection; `TextEditing.test.ts`: entering Text mode puts the caret after the edited glyph  |
| TextBuffer: insert places item at cursor                   | Insert and collapse after new item             | `TextBuffer.test.ts`: insertion advances both carets                                                                                   |
| TextBuffer: insert replaces an active selection            | Splice selected interval, collapse caret       | `TextBuffer.test.ts`: replaces a forward or backward selection                                                                         |
| TextBuffer: delete removes item before cursor              | Backspace removes preceding item               | `TextBuffer.test.ts`: backspace removes the preceding item                                                                             |
| TextBuffer: delete at buffer start                         | No-op at start                                 | `TextBuffer.test.ts`: backspace at the beginning                                                                                       |
| TextBuffer: delete with active selection                   | Selected deletion and collapse to start        | `TextBuffer.test.ts`: deletion of selected items                                                                                       |
| TextBuffer: selectAll spans 0..length                      | Full item range, including linebreaks          | `TextBuffer.test.ts`: select-all spans the item buffer; `TextEditing.test.ts`: selection history                                       |
| TextBuffer: placeCaret clamps                              | Clamp and collapse                             | `TextBuffer.test.ts`: caret placement clamps; `tools/text/Text.test.ts`: clicking a glyph in the run places the caret                  |
| TextBuffer: snapshot then restore                          | Content and caret restore together             | `TextEditing.test.ts`: inserts text and replays content and caret. `originX` is intentionally removed with drawOffset                  |
| TextBuffer: itemById follows logical item                  | IDs survive moves and vanish on deletion       | `TextBuffer.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: starts with everything null               | No active interaction at start                 | `TextEditing.test.ts`: entering and leaving Text mode                                                                                  |
| TextInteraction: setEditing stores target                  | In-place glyph target by index                 | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                            |
| TextInteraction: suspend moves editing                     | Suspend in-place glyph target across tool exit | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                            |
| TextInteraction: resume restores suspended target          | Resume in-place glyph target                   | Replaced by the run's child glyph and `TextRunNodeDefinition.onDoubleClick`                                                            |
| TextInteraction: resume with nothing                       | No suspended glyph target                      | Intentionally removed along with suspension                                                                                            |
| TextInteraction: clear resets context                      | End focus and clear hover                      | `TextEditing.test.ts`: leaving Text mode ends text editing; run hover is Select's outline hover                                        |
| TextInteraction: adjust nulls deleted indices              | Deleted glyph target no longer resolves        | `TextBuffer.test.ts`: an item identity follows insertion/deletion (absent ID resolves to no cluster); in-context target owner deferred |
| TextInteraction: adjust shifts after deletion              | Surviving identity follows reordered items     | `TextBuffer.test.ts`: an item identity follows insertions and deletions before it                                                      |
| TextInteraction: adjust shifts after insertion             | Surviving identity follows reordered items     | `TextEditing.test.ts`: a caret stays on its item when another is inserted before it                                                    |
| TextInteraction: snapshot then restore                     | Transient context round-trips                  | `TextEditing.test.ts`: inserts text and replays content and caret; suspended glyph target intentionally removed                        |
| Text tool: publishes typing until Escape returns to Select | Active text tool escapes to Select             | `tools/text/Text.test.ts`: starts editing and returns to Select on Escape                                                              |
| E2E tools: hides unavailable tools                         | Text tool hidden before rebuild                | Intentionally replaced by `tools.spec.ts`: text shortcut activates the toolbar and native input; text tool is now available            |

## Verification

`pnpm test:desktop src/renderer/src/lib/text` covers layout, pure edits, and real-editor interactions. Also run `pnpm typecheck`, `pnpm lint:check`, `pnpm format:check`, `pnpm check:browser`, and `python3 scripts/context-drift-check.py`. Manual desktop verification must cover typing, selection, undo, Escape, axis scrubbing, opening glyphs from the grid, and double-clicking run glyphs and components.

## Related

- [`Editor`](../../editor/docs/DOCS.md) — record history, scene placement, and renderer ownership.
- [`Tools`](../../tools/docs/DOCS.md) — text tool states and pointer capture lifecycle.
- [`Signals`](../../signals/docs/DOCS.md) — per-run reactive invalidation.

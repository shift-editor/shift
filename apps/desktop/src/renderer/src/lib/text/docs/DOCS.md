# Text

<!-- reviewed: 2026-08-18 review-every: 90d -->

Text editing is split into stable editor identity and derived layout geometry.

## Architecture Invariants

- **Architecture Invariant:** `TextItemId` is the durable identity for editable text items. Buffer indices and layout clusters may move after insert/delete operations; focus must remain attached to `item.id`. This exists so glyph-editing focus survives edits happening elsewhere in the run.
- **Architecture Invariant:** Clusters are layout metadata, not editor identity. A cluster index is whole-buffer monotonic and counts linebreaks; any shaped layout must map output glyphs back to source identities through `PositionedGlyph.sourceItemIds`.
- **Architecture Invariant:** `TextLayout` owns identity-to-geometry resolution. Call `editOriginForItem(itemId)` to get the current scene-space edit origin; do not cache text-run placement coordinates in tools — a rebuilt layout silently invalidates them.
- **Architecture Invariant:** Layout is derived and rebuilt whole. `TextRun.layoutCell` recomputes from buffer items, `originX`, the external axis location, and the active source; cursor and anchor moves never rebuild layout because `caretCell` and `selectionRectsCell` are layered on top. This keeps keystroke latency independent of layout cost.
- **Architecture Invariant:** Direct glyph editing uses the implicit editor run (`TextRuns.editorRun()`). Real text runs and the implicit editor run share anchor/focus/placement machinery, but only real text runs are persisted as user text content.
- **Architecture Invariant:** Buffer mutations flow through `TextRun` methods, not raw `TextBuffer` calls. `TextRun` calls `TextInteraction.adjustForBufferChange` after every item-moving mutation so held editing/suspended indices stay coherent with the buffer.
- **Architecture Invariant:** `Positioner` is the permanent no-shape product mode, not a placeholder: a literal LTR advance walk with `cluster = clusterStart + i`. It resolves advances through each glyph's `GlyphRenderModel` at the current location, so text runs interpolate during axis scrubbing without a shaping pass.

## Codemap

```text
lib/text/
  Text.ts             — document-scoped text run records and per-node layout construction
  TextBuffer.ts       — pure item/cursor/anchor/originX state with per-field signals
  TextInteraction.ts  — per-run editing slot, suspended target, and hover state
  TextRun.ts          — composes buffer + interaction; layout/caret/selection signals; goal-x nav
  TextRuns.ts         — per-glyph run store, active-run switching, implicit editor run, persistence
  layout/
    TextLayout.ts     — segment → position → assemble pipeline, hit testing, identity resolution
    Positioner.ts     — no-shape LTR advance walk with display advances and mark offsets
    Caret.ts          — immutable cluster caret with vertical goal-x navigation
    types.ts          — TextItem, PositionedGlyph, Line, and GlyphAnchor contracts
```

## Key Types

- `TextItemId` -- stable identity for a glyph or linebreak item.
- `TextItem` -- `GlyphTextItem | LineBreakTextItem`. Linebreaks are structural separators, never positioned glyphs, but they consume a cluster index.
- `GlyphAnchor` -- `{ runId, itemId }`; the durable bridge from editor focus to current layout.
- `FocusedGlyph` -- resolved anchor with the current item, glyph handle, and edit origin.
- `PositionedGlyph` -- one laid-out glyph with origin, advances, offsets, cluster, and `sourceItemIds`. Simple layout is one-to-one; shaped layout may be many-to-one or one-to-many.
- `Line` -- one paragraph's positioned runs plus baseline `y`, ascent/descent, and the `clusterStart`/`clusterEnd` window used by caret navigation.
- `Caret` -- immutable cluster position over a `TextLayout`; every navigation method returns a new instance.
- `TextRun` -- one editing surface composing `TextBuffer` and `TextInteraction`, exposing `layoutCell`, `caretCell`, and `selectionRectsCell`.
- `TextRuns` -- per-glyph-name store of runs, the active-run signal, and the implicit editor run.
- `TextRunRecord` -- persisted document-scoped proof text source owned by `Text`, placed on canvas by scene nodes.

## How it works

There are two content surfaces over one layout pipeline. `Text` owns document-scoped `TextRunRecord` values (raw proof strings, including `/name` slash escapes) and builds a node-local `TextLayout` for each placed text run node. `TextRuns` owns the interactive editing runs: one `TextRun` per glyph name so each glyph keeps its own typing context, plus a default run and the implicit `__editor__` run used by single-glyph focus.

Layout is a pure derivation: buffer items are split into paragraphs on linebreak items, each paragraph is segmented into runs (one LTR run today; the `SegmentedRun[]` shape is kept so BiDi can slot in later), each run is positioned by `Positioner`, and `assembleLayout` stacks one `Line` per paragraph at `origin.y - lineHeight * n` (y is negative-down, matching font conventions). Metrics come from the active source when one is selected and are otherwise interpolated at the current external location via `Font.metricsAtLocation`, so line height follows axis scrubbing. `Positioner` resolves each glyph through the font directory and its `GlyphRenderModel`, which makes advances and bounds location-live as well; mark glyphs get a synthetic offset from their attaching `_name` anchor or bounds center.

Focus resolution runs the pipeline backwards: a click hit-tests advance boxes to a cluster, the cluster maps to a `GlyphAnchor` holding item identity, and `TextRuns.resolveAnchor` re-reads the current buffer and layout to produce a `FocusedGlyph` with the current `editOrigin` that drives the editor's draw offset. Anchors survive layout rebuilds because only the final resolution step touches geometry.

Persistence stores `TextBuffer` snapshots per glyph key, skipping the default key and empty buffers. Deserialization repopulates the run map and then forces `activeCell` to re-resolve through a sentinel key — consumers that read the active run before load would otherwise hold a stale empty run.

## Workflow recipes

### Adding a keyboard navigation command

1. Add the movement method to `TextRun` (see `moveCursorByWord` for the shape): peek `#layout`, compute a target cluster, then `buffer.placeCaret` or `buffer.extendSelection` depending on `extend`.
2. Reset `#goalX` for horizontal moves; thread it through `Caret.nextLine`/`Caret.previousLine` for vertical ones.
3. Wire the keystroke in the hidden text input component that drives text editing.
4. Verify: `pnpm test:desktop src/renderer/src/lib/text` and `pnpm typecheck`

### Extending layout output with a new per-glyph field

1. Add the field to `PositionedGlyph` in `layout/types.ts`.
2. Populate it in `Positioner.position` — layout code must not reach around the positioner to compute placement.
3. Consume it through `TextLayout` accessors (`glyphsForItem`, `editOriginForItem`) rather than walking `lines` in callers.
4. Verify: `pnpm test:desktop src/renderer/src/lib/text/layout/Positioner.test.ts` and `pnpm test:desktop src/renderer/src/lib/text/layout/TextLayout.test.ts`

## Gotchas

- Cluster arithmetic counts linebreaks: the next paragraph's `clusterStart` is `previous.clusterStart + previous.glyphs.length + 1`, and `Line.clusterEnd` is one _past_ the last cluster (covering the trailing linebreak or the after-last caret slot). Off-by-one bugs here surface as carets landing on the wrong line.
- y is negative-down: line N's baseline is `origin.y - lineHeight * n`, ascent is positive, descent negative. A hit test band is `[y + descent, y + ascent]` — flipping the comparison finds no lines.
- `TextRun.seed` is a no-op when the buffer already has items, so `originX` is _not_ re-applied on tool re-activation. That guard is deliberate: without it the run shifts every time the user toggles Select/Text after the draw offset has moved.
- Mutating `TextBuffer` directly (instead of through `TextRun.insert`/`delete`) skips `adjustForBufferChange`, leaving `TextInteraction.editing` pointing at the wrong slot or at deleted items.
- `TextRuns.deserialize` must toggle the active key through a sentinel; the run map is not a signal, and an auto-save effect holding a pre-load run reference would otherwise serialize empty state over the loaded data.
- Empty paragraphs still produce a `Line`, and the caret can legally sit on them; caret code that assumes every line has glyphs breaks on `[A, \n, \n, B]`.

## Verification

```bash
pnpm typecheck
pnpm test:desktop src/renderer/src/lib/text
python3 scripts/context-drift-check.py
```

`pnpm test:desktop` covers the buffer, interaction, caret, positioner, and layout unit tests in this module.

## Related

- [`Renderer font model`](../../model/docs/DOCS.md) -- `Font` directory lookups, `GlyphRenderModel` advances/bounds, and source metrics interpolation consumed by layout
- [`editor`](../../editor/docs/DOCS.md) -- `Editor` owns the active source/location signals layout tracks, and consumes `FocusedGlyph.editOrigin` as its draw offset
- [`signals`](../../signals/docs/DOCS.md) -- `computed`/`batch` primitives behind the per-field buffer cells and derived layout

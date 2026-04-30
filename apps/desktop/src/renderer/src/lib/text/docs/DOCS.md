# Text

Text editing is split into stable editor identity and derived layout geometry.

## Architecture Invariants

**Architecture Invariant:** `TextCellId` is the durable identity for editable text cells. Buffer indices and layout clusters may move after insert/delete operations; focus must remain attached to `cell.id`.

**Architecture Invariant:** HarfBuzz clusters are layout metadata, not editor identity. Shaped layout must map output glyphs back to `TextCellId[]`.

**Architecture Invariant:** `TextLayout` owns identity-to-geometry resolution. Call `editOriginForCell(cellId)` to get the current scene-space edit origin; do not cache text-run placement coordinates in tools.

**Architecture Invariant:** Direct glyph editing uses the implicit editor run (`TextRuns.editorRun()`). Real text runs and the implicit editor run share anchor/focus/placement machinery, but only real text runs are persisted as user text content.

## Core Flow

```
TextBuffer cells
  -> TextLayout positioned glyphs { cellIds, origin, xOffset/yOffset }
  -> GlyphAnchor { runId, cellId }
  -> TextRuns.resolveAnchor()
  -> FocusedGlyph.editOrigin
  -> Editor.drawOffset
```

## Key Types

- **`TextCellId`** -- stable identity for a glyph or linebreak cell.
- **`GlyphAnchor`** -- `{ runId, cellId }`; the durable bridge from editor focus to current layout.
- **`FocusedGlyph`** -- resolved anchor with the current cell, glyph handle, and edit origin.
- **`PositionedGlyph.cellIds`** -- source cell identities covered by a positioned glyph. Simple layout is one-to-one; shaped layout may be many-to-one or one-to-many.
- **`Positioner`** -- current simple source-order layout implementation. It owns display advance and mark offset logic so editor placement is layout-derived.

## Direct Glyph Open

```
openGlyph(S)
   |
   v
editorRun = [S(id=s1)]
   |
   v
GlyphAnchor { runId: "__editor__", cellId: s1 }
   |
   v
TextLayout.editOriginForCell(s1)
   |
   v
drawOffset
```

## Text-Run Focus

```
run = [a(id=a1), a(id=a2), s(id=s1), d(id=d1)]
                           ^
                           click
   |
   v
GlyphAnchor { runId: run.id, cellId: s1 }
   |
   v
resolveAnchor(anchor)
   | reads current buffer + current layout
   v
FocusedGlyph { glyph: "s", editOrigin }
   |
   v
drawOffset = editOrigin
```

## Persistence

Persisted text cells must include IDs. There is no legacy repair path in the renderer: missing IDs are invalid persisted data.

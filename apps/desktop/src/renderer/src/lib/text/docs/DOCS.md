# Text

Text editing is split into stable editor identity and derived layout geometry.

## Architecture Invariants

**Architecture Invariant:** `TextItemId` is the durable identity for editable text items. Buffer indices and layout clusters may move after insert/delete operations; focus must remain attached to `item.id`.

**Architecture Invariant:** HarfBuzz clusters are layout metadata, not editor identity. Shaped layout must map output glyphs back to `TextItemId[]`.

**Architecture Invariant:** `TextLayout` owns identity-to-geometry resolution. Call `editOriginForItem(itemId)` to get the current scene-space edit origin; do not cache text-run placement coordinates in tools.

**Architecture Invariant:** Direct glyph editing uses the implicit editor run (`TextRuns.editorRun()`). Real text runs and the implicit editor run share anchor/focus/placement machinery, but only real text runs are persisted as user text content.

## Core Flow

```
TextBuffer items
  -> TextLayout positioned glyphs { sourceItemIds, origin, xOffset/yOffset }
  -> GlyphAnchor { runId, itemId }
  -> TextRuns.resolveAnchor()
  -> FocusedGlyph.editOrigin
  -> Editor.drawOffset
```

## Key Types

- **`TextItemId`** -- stable identity for a glyph or linebreak item.
- **`GlyphAnchor`** -- `{ runId, itemId }`; the durable bridge from editor focus to current layout.
- **`FocusedGlyph`** -- resolved anchor with the current item, glyph handle, and edit origin.
- **`PositionedGlyph.sourceItemIds`** -- source item identities covered by a positioned glyph. Simple layout is one-to-one; shaped layout may be many-to-one or one-to-many.
- **`Positioner`** -- current simple source-order layout implementation. It owns display advance and mark offset logic so editor placement is layout-derived.

## Direct Glyph Open

```
openGlyph(S)
   |
   v
editorRun = [S(id=s1)]
   |
   v
GlyphAnchor { runId: "__editor__", itemId: s1 }
   |
   v
TextLayout.editOriginForItem(s1)
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
GlyphAnchor { runId: run.id, itemId: s1 }
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

Persisted text items must include IDs. There is no legacy repair path in the renderer: missing IDs are invalid persisted data.

# shift-store

`shift-store` owns Shift's durable SQLite working database.

Callers use typed APIs from this crate rather than preparing SQL or opening a second application-level persistence path.

## Storage boundary

- Font metadata and the glyph/layer directory remain relational and load eagerly.
- Each editable glyph layer is one independently addressable `shift.glyph-layer.v1` BLOB.
- Component dependency rows contain only the earned query index: component ID, owner layer ID, base glyph ID, and ordinal.
- Points, contours, anchors, transforms, guidelines, and layer lib values are canonical only inside the layer BLOB; they are not duplicated as normalized SQL rows.
- Payload replacement, directory facts, component rows, and workspace revision state commit in one transaction.

`ShiftStore::load_font_directory` never reads payload BLOBs. `load_glyph_layer` bounds and validates one payload and cross-checks its directory and reference-index facts. `FontWorkspace` uses those APIs for explicit glyph acquisition and safe cache eviction.

## Import boundary

`LayerStreamWriter` accepts one parsed `GlyphLayer` at a time. A successful call encodes, indexes, commits, and releases that layer before the caller supplies the next one; no complete in-memory `Font` is required. Format-specific bounded parsers, progress/cancellation, and atomic staging installation belong to the foreign-import layer.

## Schema policy

Shift has not shipped this working-store schema. Schema changes therefore update the version-1 baseline directly; there is intentionally no compatibility migration for earlier development databases.

## Responsibilities

- configure SQLite for WAL-backed transactional work;
- own the baseline schema and raw SQL;
- preserve stable authored IDs and exact values;
- provide directory-first and bounded payload APIs;
- keep canonical payloads and relational query indexes atomic;
- support CJK-scale directories without BLOB scans.

## Main modules

```text
src/
  connection.rs    # SQLite opening, WAL, limits, foreign keys
  schema.rs        # pre-release version-1 baseline
  font_state.rs    # eager metadata/directory and explicit full materialization
  packed_layer.rs  # bounded BLOB fetch/replace and reference-index checks
  stream_writer.rs # one-layer-at-a-time import sink
  change_set.rs    # transactional workspace changes
  workspace_state.rs
```

# shift-store

`shift-store` owns Shift's durable SQLite working database.

Callers use typed APIs from this crate rather than preparing SQL or opening a second application-level persistence path.

## Storage boundary

- Font metadata and the glyph/layer directory remain relational and load eagerly.
- Each editable glyph layer is one independently addressable `shift.glyph-layer.v1` BLOB.
- Component dependency rows contain only the earned query index: component ID, owner layer ID, base glyph ID, and ordinal.
- Points, contours, anchors, transforms, guidelines, and layer lib values are canonical only inside the layer BLOB; they are not duplicated as normalized SQL rows.
- Payload replacement, directory facts, component rows, and workspace revision state commit in one transaction.

`ShiftStore::load_font_directory` never reads payload BLOBs. `load_glyph_layer` bounds and validates one payload; `load_glyph_layers` scans directory facts, bounded payloads, and reference rows once for a deduplicated batch of at most 512 layers and 256 MiB of packed bytes. Both paths cross-check canonical bytes against relational facts. `FontWorkspace` uses the batch path for explicit glyph acquisition and safe cache eviction.

## Import boundary

`LayerStreamWriter` accepts one glyph/layer or a bounded glyph batch without requiring a complete in-memory `Font`. `write_glyph_batch` canonical-encodes layers with Rayon, then writes directory rows, BLOBs, and component indexes in stable order through one SQLite transaction. `finish` is the only commit point; dropping an unfinished writer rolls the complete stream back.

`ShiftStore::open_for_import` uses rollback-capable in-memory journaling and disabled synchronous writes only while the foreign source remains authoritative and the destination is disposable. `finish_import` syncs the completed database and restores WAL + NORMAL before workspace state is published. Normal edits never use import pragmas. Progress, cancellation, source fingerprinting, and final atomic destination installation remain workspace responsibilities.

## Schema policy

Shift has not shipped this working-store schema. Schema changes therefore update the version-1 baseline directly; there is intentionally no compatibility migration for earlier development databases.

## Responsibilities

- configure SQLite for WAL-backed transactional work and a separately finalized disposable-import mode;
- own the baseline schema and raw SQL;
- preserve stable authored IDs and exact values;
- provide directory-first and bounded payload APIs;
- keep canonical payloads and relational query indexes atomic;
- support CJK-scale directories without BLOB scans.

## Main modules

```text
src/
  connection.rs    # normal WAL opening plus disposable import/finalization posture
  schema.rs        # pre-release version-1 baseline
  font_state.rs    # eager metadata/directory and explicit full materialization
  packed_layer.rs  # bounded BLOB fetch/replace and reference-index checks
  stream_writer.rs # bounded Rayon pack plus single-transaction SQLite sink
  change_set.rs    # transactional workspace changes
  workspace_state.rs
```

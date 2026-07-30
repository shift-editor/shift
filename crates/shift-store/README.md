# shift-store

`shift-store` owns Shift's durable SQLite working database.

Callers use typed APIs from this crate rather than preparing SQL or opening a second application-level persistence path.

## Storage boundary

- Font metadata and the glyph/layer directory remain relational and load eagerly. Layer rows reference their glyph rather than duplicating its editable name.
- Each editable glyph layer is one independently addressable payload. Its canonical decoded bytes remain `shift.glyph-layer.v1`; the store independently wraps them as `none` or `zstd.v1` without changing authored semantics.
- Component dependency rows contain only the earned query index: component ID, owner layer ID, base glyph ID, and ordinal.
- Points, contours, anchors, transforms, guidelines, and layer lib values are canonical only inside the layer BLOB; they are not duplicated as normalized SQL rows.
- Payload replacement, directory facts, component rows, and workspace revision state commit in one transaction.

`ShiftStore::load_font_directory` never reads payload BLOBs. `load_glyph_layer` bounds stored and decoded lengths before fetching and decompressing one payload. `load_glyph_layers` accepts a complete requested set, deduplicates it, and partitions it through the single count- and decoded-byte-aware planner. Each internal batch performs three ordered directory/payload/reference scans for at most 512 layers and 256 MiB decoded bytes, then decompresses and validates with Rayon. Every decoded payload must match its exact declared length and 32-byte BLAKE3 before strict canonical decoding. Full-font materialization and workspace acquisition use that same planner; no caller maintains a weaker count-only loop. All payload paths cross-check canonical bytes against relational facts.

## Outer payload contract

`glyph_layer_payloads` stores `inner_format`, `compression`, `stored_byte_length`,
`decoded_byte_length`, `decoded_blake3`, and `payload`. `inner_format` remains
`shift.glyph-layer.v1`. Compression is either `none` or `zstd.v1`; `zstd.v1` means one complete
independent Zstandard frame with no dictionary. Level 1 is the current write policy, not a decoding
requirement. Writers retain compressed bytes only when they are smaller than the canonical input.

`decoded_blake3` is the 32-byte BLAKE3 of the exact canonical bytes. Reads bound both lengths before
fetch/allocation, reject trailing Zstandard data, require the exact decoded length and hash, and
only then invoke strict canonical decoding. A layer replacement may move between `none` and
`zstd.v1` without changing its inner bytes or touching another layer.

## Import boundary

`LayerStreamWriter` accepts bounded replacement glyph batches without requiring a complete in-memory `Font`. `pack_glyph_batch` canonical-encodes, BLAKE3-hashes, and independently compresses an owned batch with Rayon without borrowing the SQLite transaction, allowing the workspace to overlap parsing, packing/compression, and one stable-order SQLite writer. Streaming inserts, full-state replacement, and change-set replacement share one write implementation parameterized only by insert/upsert mode. Change sets supplied with a committed post-edit font skip incremental decode/re-encode for touched existing layers and write each final layer once. Secondary query indexes are dropped inside the stream transaction and rebuilt in bulk by `finish`; dropping an unfinished writer restores them with the rest of the rollback. Prefix-redundant Unicode-glyph and component-layer indexes are omitted. `finish` is the only stream commit point.

`ShiftStore::open_for_import` uses rollback-capable in-memory journaling and disabled synchronous writes only while the foreign source remains authoritative and the path is disposable. `finish_import` syncs the completed database and restores WAL + NORMAL. Normal edits never use import pragmas. `FontWorkspace` opens imports at a sibling staging path, writes workspace state there, makes the staged database durable, closes it, atomically installs it at the requested destination, and syncs the parent directory. A failure before installation leaves the previous destination untouched.

## Schema policy

Shift has not shipped this working-store schema. Schema changes therefore update the version-1 baseline directly; there is intentionally no compatibility migration for earlier development databases.

## Responsibilities

- configure SQLite for WAL-backed transactional work and a separately finalized disposable-import mode;
- own the baseline schema and raw SQL;
- preserve stable authored IDs and exact values;
- provide directory-first and bounded canonical payload APIs rather than row-level outline/component compatibility models;
- keep canonical payloads and relational query indexes atomic;
- support CJK-scale directories without BLOB scans.

## Main modules

```text
src/
  connection.rs    # normal WAL opening plus disposable import/finalization posture
  schema.rs        # pre-release version-1 baseline
  font_state.rs    # eager metadata/directory and explicit full materialization
  packed_layer.rs  # bounded BLOB fetch/replace and reference-index checks
  stored_layer.rs  # independent Zstd/BLAKE3 outer storage representation
  stream_writer.rs # independently pipelined Rayon pack/compress plus single-transaction SQLite sink
  write_mode.rs    # shared insert/upsert policy for canonical write paths
  change_set.rs    # transactional workspace changes and one final touched-layer write
  workspace_state.rs
```

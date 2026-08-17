# shift-store

`shift-store` owns Shift's SQLite persistence boundary: the canonical `.shift` application database and the separate app-local working database used during editing and import.

Callers use typed APIs from this crate rather than preparing SQL or opening a second application-level persistence path. The desktop app has not yet cut over from the legacy ZIP package, so the canonical document APIs are currently a tested foundation rather than the active Save/Open route.

## Canonical document boundary

- A `.shift` document is the SQLite database itself. It uses application ID `SHFT` (`0x53484654`) and an exact `user_version` contract.
- `ShiftStore::create_document` writes a complete `shift-font::Font` at a sibling staging path, syncs it, and publishes without clobbering an existing destination.
- `ShiftStore::open_document` validates the file read-only before opening it with rollback journaling and `synchronous=FULL`. `ShiftStore::verify_document` also runs SQLite integrity and foreign-key checks.
- `DocumentMetadata` contains the stable `DocumentId`. A raw copy preserves it; Save As will mint a new identity at the workspace boundary.
- Canonical documents never contain app-local `workspace_state`. Working databases retain WAL + NORMAL and their revision/source-binding row.

## Storage boundary

- Font metadata and the glyph/layer directory remain relational and load eagerly. Layer rows reference their glyph rather than duplicating its editable name.
- Each editable glyph layer is one independently addressable, store-private MessagePack payload identified as `shift.glyph-layer.v1`; the store independently wraps it as `none` or `zstd.v1` without changing authored semantics.
- Component dependency rows contain only the earned query index: component ID, owner layer ID, base glyph ID, and ordinal.
- Points, contours, anchors, transforms, guidelines, and layer lib values are canonical only inside the layer BLOB; they are not duplicated as normalized SQL rows.
- Payload replacement, directory facts, component rows, monotonic workspace revision, and the workspace-supplied dirty value commit in one transaction.

`ShiftStore::load_font_directory` never reads payload BLOBs. `load_glyph_layer` bounds stored and decoded lengths before fetching and decompressing one payload. `load_glyph_layers` accepts a complete requested set, deduplicates it, and partitions it through the single count- and decoded-byte-aware planner. Each internal batch performs three ordered directory/payload/reference scans for at most 512 layers and 256 MiB decoded bytes, then decompresses and validates with Rayon. Every decoded payload must match its exact declared length and 32-byte BLAKE3 before strict MessagePack decoding. Full-font materialization and workspace acquisition use that same planner; no caller maintains a weaker count-only loop. All payload paths cross-check canonical bytes against relational facts.

## Outer payload contract

`glyph_layer_payloads` stores `inner_format`, `compression`, `stored_byte_length`,
`decoded_byte_length`, `decoded_blake3`, and `payload`. `inner_format` remains
`shift.glyph-layer.v1`. Its bytes are `rmp-serde`'s compact serialization of `GlyphLayer`; struct field order and enum Serde attributes are format-bearing and require a new identifier if changed. Compression is either `none` or `zstd.v1`; `zstd.v1` means one complete independent Zstandard frame with no dictionary. Level 1 is the current write policy, not a decoding
requirement. Writers retain compressed bytes only when they are smaller than the canonical input.

`decoded_blake3` is the 32-byte BLAKE3 of the exact canonical bytes. Reads bound both lengths before
fetch/allocation, reject trailing Zstandard data, require the exact decoded length and hash, and
only then invoke strict MessagePack decoding. A layer replacement may move between `none` and
`zstd.v1` without changing its inner bytes or touching another layer.

## Import boundary

`FontImportWriter` accepts bounded replacement glyph batches without requiring a complete in-memory `Font`. `encode_glyph_batch` MessagePack-encodes, BLAKE3-hashes, and independently compresses an owned batch with Rayon without borrowing the SQLite transaction, allowing the workspace to overlap parsing, encoding/compression, and one stable-order SQLite writer. Streaming inserts, full-state replacement, and change-set replacement share one write implementation parameterized only by insert/upsert mode. Change sets supplied with a committed post-edit font skip incremental decode/re-encode for touched existing layers and write each final layer once. Secondary query indexes are dropped inside the stream transaction and rebuilt in bulk by `finish`; dropping an unfinished writer restores them with the rest of the rollback. Prefix-redundant Unicode-glyph and component-layer indexes are omitted. `finish` is the only stream commit point.

`ShiftStore::open_for_import` uses rollback-capable in-memory journaling and disabled synchronous writes only while the authoring source remains authoritative and the path is disposable. `finish_import` syncs the completed database and restores WAL + NORMAL. Normal edits never use import pragmas. `FontWorkspace` opens imports at a sibling staging path, writes workspace state there, makes the staged database durable, closes it, removes the closed staging WAL/SHM sidecars, atomically installs the main database at the requested destination, and syncs the parent directory. A failure before installation leaves the previous destination untouched.

## Preservation and export gate

Canonical SQLite publication must preserve the complete `shift-font::Font`, not a projection chosen for one exporter. The kitchen-sink canonical-document test covers metadata, metrics, axes and mappings, named instances, sources, kerning, features, libs, binary data, guidelines, glyph layers, components, anchors, and stable authored identities through SQLite equality. UFO and Designspace exports must materialize that complete canonical state and use their dedicated writers. Any concept the target format cannot represent requires an explicit export diagnostic; no exporter may silently narrow the canonical document or route through another authoring format.

## Schema policy

Shift has not shipped either SQLite schema. Schema changes therefore update the version-1 baselines directly; there is intentionally no compatibility migration for earlier development databases. Canonical document schema stabilization is gated on preservation/export goldens and hostile-input budgets.

## Responsibilities

- configure SQLite for canonical rollback/FULL durability, WAL-backed transactional work, and a separately finalized disposable-import mode;
- own the canonical and working version-1 schemas and raw SQL;
- preserve stable authored IDs and exact values;
- provide directory-first and bounded canonical payload APIs rather than row-level outline/component compatibility models;
- keep canonical payloads and relational query indexes atomic;
- support CJK-scale directories without BLOB scans.

## Main modules

```text
src/
  connection.rs     # canonical, working-WAL, and disposable-import connection postures
  document.rs       # staged create, validated open/verify, metadata, and durable publication
  schema.rs         # canonical and working pre-release version-1 baselines
  font_state.rs     # eager metadata/directory and explicit full materialization
  import_writer.rs  # pipelined Rayon encode/compress plus one SQLite transaction owner
  layer/
    format.rs       # strict MessagePack encoding and domain validation
    payload.rs      # independent Zstd/BLAKE3 storage representation
    directory.rs    # relational metadata and row cross-validation
    load.rs         # bounded single and batch BLOB reads
    write.rs        # transactional payload and reference-index writes
    references.rs   # component dependency queries and index validation
    tests.rs        # integrated SQLite layer behavior
  write_mode.rs     # shared insert/upsert policy for canonical write paths
  change_set.rs     # transactional workspace changes and one final touched-layer write
  workspace_state.rs
```

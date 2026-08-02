# shift-workspace

Backend runtime object for an open Shift font workspace.

## Architecture Invariants

- **Architecture Invariant:** `FontWorkspace` composes a directory-complete, payload-lazy `shift-font::Font`, the user-selected `shift-source` package, and the working `shift-store` database.
- **Architecture Invariant:** Resuming SQLite loads metadata and glyph/layer directory facts only. `acquire_glyphs` performs explicit bounded payload I/O; synchronous `font()` reads never initiate I/O.
- **Architecture Invariant:** TTF/OTF, UFO, Designspace, and Glyphs imports consume bounded `FontImport` batches and write through one `FontImportWriter`; they never construct a complete geometry-resident Shift `Font`. Glyph conversion, MessagePack encoding, BLAKE3 hashing, and independent per-layer compression use Rayon, while SQLite has one transaction owner. The upstream Glyphs parser still materializes its normalized source model before bounded Shift conversion begins.
- **Architecture Invariant:** `LayerResidency` is the sole owner of loaded-layer membership and placeholder replacement. A loaded layer is only a cache of already-committed authored state; apply, undo, and redo reacquire their complete layer read sets before mutation, and `evict_glyphs` replaces only committed layers with directory placeholders.
- **Architecture Invariant:** The `.shift` source package path and SQLite working store path are separate inputs.
- **Architecture Invariant:** Package recovery policy is not ranked in Rust. `FontWorkspace` exposes package and working-store inspection primitives; the utility process owns binding and lifecycle decisions.
- **Architecture Invariant:** The workspace is the domain object future bridge or utility-process transports should wrap.
- **Architecture Invariant:** `slug_atlas_cache_revision()` reads the durable authored workspace revision as an opaque string for disposable derived-cache addressing. It does not persist preview bytes or make them authored state.
- **Architecture Invariant:** Ledger layer pairs retain the original touched-layer structural classification. Values-only undo/redo restores the target snapshot's canonical numeric values without rebuilding identity indexes or emitting structure; structural replay installs and emits the complete target structure in both directions.
- **Architecture Invariant:** Ledger replay restores complete named-instance collections after axis topology so undo/redo never observes an instance against the wrong external-axis shape.
- **Architecture Invariant:** Metadata ledger entries store complete pre/post snapshots and replay them independently of font metrics.
- **Architecture Invariant:** Metric-definition ledger state replays before complete source snapshots so source metric IDs are always valid during undo and redo.
- **Architecture Invariant:** Undo and redo retain at most 100 entries per stack. Extending either stack drops that stack's oldest entry; a fresh apply clears redo.

## Codemap

```
crates/shift-workspace/src/
  lib.rs           -- public API barrel
  new_workspace.rs -- creation options for a fresh workspace
  source_identity.rs -- package identity snapshots and source-save validation
  import_pipeline.rs -- bounded parser/parallel-packer/single-writer pipeline and progress observer
  import_staging.rs  -- sibling staged-store creation, atomic installation, and parent sync
  layer_residency.rs -- complete read sets, bounded acquisition, and safe eviction
  ledger.rs        -- bounded snapshot-pair undo/redo entries
  workspace.rs     -- `FontWorkspace` orchestration and workspace errors
crates/shift-workspace/examples/
  profile_streaming_import.rs -- shared release-mode foreign/native import profiler
```

## Key Types

- `FontWorkspace` -- live backend object for one open font project.
- `NewWorkspace` -- options used when creating a new source package and working store.
- `PackageIdentity` -- package id, canonical path, and fingerprint for one `.shift` source.
- `PackageDraft` -- package ownership and dirty/base fingerprint state read from a working store.
- `WorkspaceSource` -- explicit source state: saved `.shift` package or imported external file.
- `WorkspaceError` -- source-package and store failures.

## How it works

`FontWorkspace::create(source_path, store_path, options)` creates a placeholder `.shift` package, opens the working SQLite store, writes initial font metadata, and starts with an empty `shift-font::Font`.

`FontWorkspace::open(path, store_path)` detects `.shift` paths as source packages. TTF/OTF, UFO, Designspace, Glyphs, and Glyphs package paths use a metadata/directory-first backend cursor, convert batches of at most 512 glyphs and 1,024 authored layers, parallel-pack/hash/compress those layers, and insert them into a disposable sibling staging database. The legal import transitions are **Staging** (foreign source remains authoritative), **Durable** (stream committed, indexes restored, workspace state written, database synced), then **Published** (closed staging file atomically installed and parent directory synced). Failure before Published removes staging and leaves the previous destination untouched. The returned workspace contains directory placeholders and zero loaded layer payloads. Glyphs source syntax is parsed once into the upstream normalized model before its cursor publishes the header and directory; subsequent Shift conversion and persistence remain bounded. This synchronous API still returns only after finalization; publishing the directory and binary packed-outline grid while import continues requires the separate app import-session boundary. Other supported foreign formats retain the eager compatibility path until they gain a bounded reader.

`FontWorkspace::save()` succeeds for saved `.shift` workspaces and returns `NeedsSaveAs` for imported workspaces. `save_as(path)` creates a `.shift` package and makes it the save target.

`FontWorkspace::inspect_package(path)` reads a `.shift` package without opening it as the live workspace. It returns the stable package id, canonical path, and fingerprint used by the utility process to address a package instance.

`FontWorkspace::inspect_package_draft(store_path)` reads the working-store package ownership record without resuming it. It returns the package id, source path, base fingerprint, document id, and dirty flag so the utility process can choose an explicit open transition.

`FontWorkspace::slug_atlas_cache_revision()` returns the persisted authored revision used by the utility process to distinguish disposable `CachedAtlas` entries across edits and process restarts. Save does not alter this key when authored content is unchanged.

`FontWorkspace::resume(store_path)` builds the eager directory skeleton without reading any layer BLOB. `acquire_glyphs(ids, AcquireScope::Glyphs)` fetches only requested layers; `AcquireScope::ComponentClosure` first expands component dependencies from the relational index. Acquisition passes the complete request to the store's shared count- and decoded-byte-aware planner. Each internal batch reads directory facts, payloads, and component indexes for at most 512 layers and 256 MiB decoded bytes, decompresses and verifies exact lengths plus BLAKE3 in parallel, accumulates the canonical results, and validates the complete replacement before mutating the uniquely owned live font in place. Validated identity sets become the final index entries rather than a temporary duplicate; shared font snapshots still use copy-on-write. A malformed batch does not replace the live cache. Save/export explicitly acquire all layers before creating their complete snapshots.

## Profiling

`profile_streaming_import` uses the same public `stream_into` three-stage pipeline as the workspace and reports foreign-directory, parse, MessagePack encode, compression, SQLite write, commit, durable-finalization, native-directory materialization, reopen, decoded/stored BLOB, and database measurements without putting machine-specific timing assertions in tests:

```bash
cargo build --release -p shift-workspace --example profile_streaming_import
/usr/bin/time -v target/release/examples/profile_streaming_import \
  /path/to/font-or-project /tmp/import.sqlite
```

Use `RAYON_NUM_THREADS`, `SHIFT_IMPORT_BATCH_GLYPHS`, and `SHIFT_IMPORT_BATCH_LAYERS` to compare worker and bounded-batch limits. `SHIFT_IMPORT_PROGRESS_BATCHES` controls machine-readable periodic lines containing cumulative batches, glyphs, layers, parse, pack, compression, SQLite, wall time, and throughput. MessagePack encoding, hashing, and compression use Rayon; the SQLite writer remains single-threaded.

A repeatable ignored corpus gate exercises streaming import, directory-only
resume, and bounded acquisition without checking large fonts into Git:

```bash
SHIFT_STRESS_FONT=/path/to/SourceHanSans-VF.ttf \
SHIFT_STRESS_MIN_GLYPHS=65000 SHIFT_STRESS_MIN_LAYERS=65000 \
cargo test -p shift-workspace configured_large_corpus_streams_resumes_and_acquires \
  -- --ignored --nocapture
```

Set both expectations for the selected, checksum-pinned local corpus. Timing and
RSS remain profiler observations rather than CI assertions.

## Verification

- `cargo test -p shift-workspace`

## Related

- `shift-source` -- user-authored `.shift` package layout.
- `shift-store` -- working SQLite store.
- `shift-font` -- live font object model.

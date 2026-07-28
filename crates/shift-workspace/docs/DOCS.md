# shift-workspace

Backend runtime object for an open Shift font workspace.

## Architecture Invariants

- **Architecture Invariant:** `FontWorkspace` composes a directory-complete, payload-lazy `shift-font::Font`, the user-selected `shift-source` package, and the working `shift-store` database.
- **Architecture Invariant:** Resuming SQLite loads metadata and glyph/layer directory facts only. `acquire_glyphs` performs explicit bounded payload I/O; synchronous `font()` reads never initiate I/O.
- **Architecture Invariant:** TTF/OTF, UFO, and Designspace imports consume bounded `FontImport` batches and write through one `LayerStreamWriter`; they never construct a complete geometry-resident `Font`. Format readers and canonical packing use Rayon, while SQLite has one transaction owner.
- **Architecture Invariant:** A loaded layer is only a cache of already-committed authored state. `evict_glyphs` replaces it with a directory placeholder and cannot lose an edit.
- **Architecture Invariant:** The `.shift` source package path and SQLite working store path are separate inputs.
- **Architecture Invariant:** Package recovery policy is not ranked in Rust. `FontWorkspace` exposes package and working-store inspection primitives; the utility process owns binding and lifecycle decisions.
- **Architecture Invariant:** The workspace is the domain object future bridge or utility-process transports should wrap.
- **Architecture Invariant:** Ledger replay restores complete named-instance collections after axis topology so undo/redo never observes an instance against the wrong external-axis shape.
- **Architecture Invariant:** Metadata ledger entries store complete pre/post snapshots and replay them independently of font metrics.
- **Architecture Invariant:** Metric-definition ledger state replays before complete source snapshots so source metric IDs are always valid during undo and redo.

## Codemap

```
crates/shift-workspace/src/
  lib.rs           -- public API barrel
  new_workspace.rs -- creation options for a fresh workspace
  source_identity.rs -- package identity snapshots and source-save validation
  workspace.rs     -- `FontWorkspace` and workspace errors
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

`FontWorkspace::open(path, store_path)` detects `.shift` paths as source packages. TTF/OTF, UFO, and Designspace paths use a metadata/directory-first backend cursor, parse batches of at most 512 glyphs and 1,024 authored layers, parallel-pack those layers, and insert them into a disposable import connection. After the complete stream commits, `finish_import` syncs the database and restores edit-time WAL settings. The returned workspace contains directory placeholders and zero loaded layer payloads. This synchronous API still returns only after finalization; publishing the directory and binary packed-outline grid while import continues requires the separate app import-session boundary. Other supported foreign formats retain the eager compatibility path until they gain a bounded reader.

`FontWorkspace::save()` succeeds for saved `.shift` workspaces and returns `NeedsSaveAs` for imported workspaces. `save_as(path)` creates a `.shift` package and makes it the save target.

`FontWorkspace::inspect_package(path)` reads a `.shift` package without opening it as the live workspace. It returns the stable package id, canonical path, and fingerprint used by the utility process to address a package instance.

`FontWorkspace::inspect_package_draft(store_path)` reads the working-store package ownership record without resuming it. It returns the package id, source path, base fingerprint, document id, and dirty flag so the utility process can choose an explicit open transition.

`FontWorkspace::resume(store_path)` builds the eager directory skeleton without reading any layer BLOB. `acquire_glyphs(ids, include_references)` fetches requested layers and can expand component closure from the relational reference index. Acquisition reads directory facts, payloads, and component indexes in ordered batches of at most 512 layers and 256 MiB of packed bytes, then decodes each batch into a COW candidate font. Each batch scans SQLite and copies the complete identity index only once; a malformed request does not replace the live cache. Save/export explicitly acquire all layers before creating their complete snapshots.

## Profiling

`profile_streaming_import` reports foreign-directory, parse, pack/write, commit, durable-finalization, native-directory materialization, reopen, BLOB, and database measurements without putting machine-specific timing assertions in tests:

```bash
cargo build --release -p shift-workspace --example profile_streaming_import
/usr/bin/time -v target/release/examples/profile_streaming_import \
  /path/to/font-or-project /tmp/import.sqlite
```

Use `RAYON_NUM_THREADS`, `SHIFT_IMPORT_BATCH_GLYPHS`, and `SHIFT_IMPORT_BATCH_LAYERS` to compare worker and bounded-batch limits. The SQLite writer remains single-threaded.

## Verification

- `cargo test -p shift-workspace`

## Related

- `shift-source` -- user-authored `.shift` package layout.
- `shift-store` -- working SQLite store.
- `shift-font` -- live font object model.

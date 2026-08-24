# shift-workspace

<!-- reviewed: 2026-08-21 review-every: 90d -->

Backend runtime object for an open Shift font workspace.

## Architecture Invariants

- **Architecture Invariant:** `FontWorkspace` composes a directory-complete, payload-lazy `shift-font::Font` with one `shift-store` posture: a canonical SQLite document plus sparse recovery overlay, or an app-owned working database for new/imported content.
- **Architecture Invariant:** Resuming SQLite loads metadata and glyph/layer directory facts only. `acquire_glyphs` performs explicit bounded payload I/O; synchronous `font()` reads never initiate I/O.
- **Architecture Invariant:** TTF/OTF, UFO, Designspace, and Glyphs imports consume bounded `FontImport` batches and write through one `FontImportWriter`; they never construct a complete geometry-resident Shift `Font`. Glyph conversion, MessagePack encoding, BLAKE3 hashing, and independent per-layer compression use Rayon, while SQLite has one transaction owner. The upstream Glyphs parser still materializes its normalized source model before bounded Shift conversion begins.
- **Architecture Invariant:** `LayerResidency` is the sole owner of loaded-layer membership and placeholder replacement. A loaded layer is only a cache of already-committed authored state; apply, undo, and redo reacquire their complete layer read sets before mutation, and `evict_glyphs` replaces only committed layers with directory placeholders.
- **Architecture Invariant:** `open_document(document_path, recovery_path)` reads the canonical `.shift` SQLite file directly and exposes merged rows from an app-owned sparse overlay. It never unpacks or copies the canonical document.
- **Architecture Invariant:** Canonical Save is explicit. Each completed mutation is already durable in the recovery overlay; Save applies only those sparse rows and tombstones, while Discard clears them and reloads the canonical directory.
- **Architecture Invariant:** Recovery allocation and document-address binding policy remain outside Rust. `FontWorkspace` verifies `DocumentIdentity` and opens the paths selected by the utility process.
- **Architecture Invariant:** The workspace is the domain object future bridge or utility-process transports should wrap.
- **Architecture Invariant:** `slug_atlas_cache_revision()` reads a durable authored revision as an opaque string for disposable derived-cache addressing. Native documents combine canonical `saved_commit_id` with the recovery revision, so every completed unsaved mutation invalidates derived output across process restarts.
- **Architecture Invariant:** Ledger layer pairs retain the original touched-layer structural classification. Values-only undo/redo restores the target snapshot's canonical numeric values without rebuilding identity indexes or emitting structure; structural replay installs and emits the complete target structure in both directions.
- **Architecture Invariant:** Ledger replay restores complete named-instance collections after axis topology so undo/redo never observes an instance against the wrong external-axis shape.
- **Architecture Invariant:** Metadata ledger entries store complete pre/post snapshots and replay them independently of font metrics.
- **Architecture Invariant:** Metric-definition ledger state replays before complete source snapshots so source metric IDs are always valid during undo and redo.
- **Architecture Invariant:** Source and axis topology entries retain complete pre/post identity order. Replay restores entities first, then restores collection order and the source collection's default identity; SQLite persists the same dense order in that transaction.
- **Architecture Invariant:** `LedgerStep::GlyphAppend` represents the only authored glyph-topology transition. Redo appends in application order and undo pops in reverse order; persistence materializes and rewrites only those tail rows, never the complete glyph directory.
- **Architecture Invariant:** After every successful apply, undo, or redo, loading the merged durable store produces the live `Font`; a failed transition changes neither live state, durable state, nor ledger availability.
- **Architecture Invariant:** Undo and redo retain at most 100 entries per stack. Extending either stack drops that stack's oldest entry; a fresh apply clears redo.
- **Architecture Invariant:** Document `dirty` compares the ledger's current history position with its saved position; the durable authored revision remains monotonic and is not an undo cursor. Undo/redo persist their resulting dirty value atomically with replay. A resumed dirty workspace has no reachable saved position because its in-memory ledger does not survive process restart.

## Codemap

```
crates/shift-workspace/src/
  lib.rs           -- public API barrel
  new_workspace.rs -- creation options for a fresh workspace
  document_identity.rs -- canonical `DocumentId` and canonical-path inspection
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
- `NewWorkspace` -- options used when creating a new app-owned working database.
- `DocumentIdentity` -- canonical `DocumentId` and canonical path for one native `.shift` document address.
- `WorkspaceSource` -- explicit source state: untitled, native document, or imported external file.
- `WorkspaceError` -- document, import-backend, and store failures.

## How it works

`FontWorkspace::create_untitled(store_path, NewWorkspace)` opens an app-owned working SQLite database, writes initial font metadata, and starts with an empty `shift-font::Font` and no canonical save target.

`FontWorkspace::open(path, store_path)` imports supported foreign sources into the same working posture. TTF/OTF, UFO, Designspace, Glyphs, and Glyphs package paths use a metadata/directory-first backend cursor, convert batches of at most 512 glyphs and 1,024 authored layers, parallel-pack/hash/compress those layers, and insert them into a disposable sibling staging database. The legal import transitions are **Staging** (foreign source remains authoritative), **Durable** (stream committed, indexes restored, workspace state written, database synced), then **Published** (closed staging file atomically installed and parent directory synced). Failure before Published removes staging and leaves the previous destination untouched. The returned workspace contains directory placeholders and zero loaded layer payloads. Glyphs source syntax is parsed once into the upstream normalized model before its cursor publishes the header and directory; subsequent Shift conversion and persistence remain bounded. This synchronous API still returns only after finalization; publishing the directory and binary packed-outline grid while import continues happens in the app's session layer (`FontSessionHost` in the main process, `FontSourceSession` in the utility process), not here. Every supported foreign format (UFO, Glyphs and Glyphs package, Designspace, TTF/OTF) streams through this bounded pipeline; the eager `read_font` compatibility fallback runs only when a backend reports streaming as unsupported, which no supported format does today.

`FontWorkspace::open_document(document_path, recovery_path)` verifies the canonical document header and `DocumentId`, opens its directory without layer payload reads, reconciles the overlay by commit identity, and exposes merged canonical/recovery views. `inspect_document(path)` performs the read-only identity check used for desktop session deduplication.

`FontWorkspace::save()` applies sparse recovery changes when the source is `WorkspaceSource::Document`; clean saves are no-ops. `discard_recovery()` clears the overlay and reloads the canonical directory. `save_as_document(path, recovery_path)` publishes the merged view as a new canonical identity, opens a fresh overlay for it, and adopts the destination as the workspace target. Untitled and imported workspaces require that native Save As path.

`FontWorkspace::slug_atlas_cache_revision()` returns the persisted authored revision used by the utility process to distinguish disposable `CachedAtlas` entries across edits and process restarts. For native documents the key is `saved_commit_id:recovery_revision`; Save changes the commit identity and resets the overlay revision, while Discard returns to the prior clean key.

`FontWorkspace::resume(store_path)` builds the eager directory skeleton without reading any layer BLOB. `acquire_glyphs(ids, AcquireScope::Glyphs)` fetches only requested layers; `AcquireScope::ComponentClosure` first expands component dependencies from the relational index. Acquisition passes the complete request to the store's shared count- and decoded-byte-aware planner. Each internal batch reads directory facts, payloads, and component indexes for at most 512 layers and 256 MiB decoded bytes, decompresses and verifies exact lengths plus BLAKE3 in parallel, accumulates the canonical results, and validates the complete replacement before mutating the uniquely owned live font in place. Validated identity sets become the final index entries rather than a temporary duplicate; shared font snapshots still use copy-on-write. A malformed batch does not replace the live cache. Export explicitly acquires all layers before creating its complete snapshot; document Save and Save As operate from durable store views and do not depend on live layer residency.

## Profiling

`profile_streaming_import` uses the same public `stream_into` three-stage pipeline as the workspace and reports foreign-directory, parse, MessagePack encode, compression, SQLite write, commit, durable-finalization, native-directory materialization, reopen, decoded/stored BLOB, and database measurements without putting machine-specific timing assertions in tests:

```bash
cargo build --release -p shift-workspace --example profile_streaming_import
# GNU/Linux: /usr/bin/time -v; macOS: /usr/bin/time -l
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

Set both expectations to match the selected local corpus; the gate asserts only
these minimum glyph and layer counts. It also reports one glyph append and undo
through the normal workspace persistence path. Timing and RSS remain profiler
observations rather than CI assertions.

## Workflow recipes

### Making a new intent undoable

1. Layer-scoped intents need no ledger wiring: `FontWorkspace::apply` acquires the intent's `required_layer_ids`, snapshots pre states, and derives `LayerPair` steps from the touched layers in the returned `AppliedIntents` automatically.
2. Font-level intents must capture their pre state in `capture_font_level_pre_state` and be mapped to a `LedgerStep` variant in `ledger_steps` (both in `workspace.rs`).
3. Add a matching `replay_*` helper (like `replay_named_instances`) and dispatch it from `replay`; `ReplaySide::Pre` (undo) and `ReplaySide::Post` (redo) share the same path, so one helper covers both directions.
4. Respect replay ordering: axis topology before named instances, metric definitions before complete source snapshots, and collection order/default identity after entity existence.
5. Verify: `cargo test -p shift-workspace` with a test that applies, undoes, and redoes the intent, asserting exact `Font` equality with a reloaded merged store after every transition.

### Adding a read that touches layer payloads

1. Route it through `acquire_glyphs(ids, AcquireScope::Glyphs)` — or `AcquireScope::ComponentClosure` when component geometry matters — before reading `font()`. Synchronous `font()` must never initiate I/O.
2. Keep acquisition batched: pass the complete request in one call so the store's count/decoded-byte planner can bound each internal batch, rather than looping per glyph.
3. If the read produces a complete in-memory snapshot, acquire all layers first like export does; a directory placeholder in that snapshot is a bug. Document Save and Save As are store-owned and do not require this acquisition.
4. Verify: `cargo test -p shift-workspace`.

## Gotchas

- `font()` reflects only what has been acquired. A glyph present in the directory but never acquired shows placeholder layers with no error — forgetting acquisition produces silently empty geometry, not a crash.
- One `apply` call = one SQLite transaction = one undo step, even for multi-intent sets. Batching intents into a single `FontIntentSet` is the only way to get one undo step; there is no separate ledger grouping API.
- A failed undo/redo replay pushes the entry back onto its stack instead of half-applying, so a replay error is retryable — but code that pops the ledger around `replay` must preserve that restore-on-error contract.
- The undo and redo stacks each cap at 100 entries and drop the oldest silently. Tests that build long histories and then unwind them fully will pass at small sizes and lie at scale.
- Dirty is a ledger-position comparison, not a revision comparison. After `resume`, a workspace that was dirty at shutdown has no reachable saved position: no amount of undo makes it report clean.
- `evict_glyphs` performs no committed-state check — it drops any loaded layer back to a directory placeholder. Eviction is still safe because `apply`, undo, and redo persist every authored edit before swapping the live font, so an uncommitted loaded layer cannot exist. Code that mutates the live font without persisting first would break that guarantee and make eviction lose work.
- A failed import removes its sibling staging database and leaves the destination untouched. Never treat a leftover staging file as resumable state; only the Published database is real.
- `FontWorkspace::open()` rejects native `.shift` documents because they require an explicit recovery path; use `open_document()`.
- Untitled and imported workspaces have no canonical target until `save_as_document()` succeeds.
- Recovery revisions are durable cache invalidators, not undo cursors. In-memory undo history does not survive restart.

## Verification

- `cargo test -p shift-workspace`

## Related

- `shift-store` -- canonical SQLite documents, working stores, and sparse recovery overlays.
- `shift-font` -- live font object model.

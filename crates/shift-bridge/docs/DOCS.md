# shift-bridge

<!-- reviewed: 2026-10-31 review-every: 90d -->

The native addon the utility process calls: four `#[pack::interface]` traits on one `Bridge` (`NativeWorkspace`, `NativeAtlas`, `NativeSource`, `NativeShaping`), each answered by one napi request export, plus the napi methods the traits do not carry yet.

## Architecture Invariants

**Architecture Invariant:** The bridge does not own hidden edit sessions or durable font state directly. It owns an optional `FontWorkspace` and forwards mutation transactions into `shift-workspace`. **WHY:** Renderer selection state stays in TypeScript, transport stays in `shift-bridge`, and workspace/store synchronization has one Rust owner.

**Architecture Invariant:** `LayerReader` only reads. It opens a store read-only through `shift-store`'s `StoreReader`, beside the utility process that writes it, and implements shift-engine's `StoreReader` request protocol over it: its one `request(method, numbers, blobs)` export answers what the window's engine encoded, returning layers as one MessagePack array of named-field layers (a `pack::Bytes` blob) and failures in the reply as a `StoreReadError`. It reads the request in place and copies the reply's blobs into JavaScript once (`BufferSlice::copy_from`): Electron's V8 sandbox refuses external buffers, so napi would copy them anyway, and an external buffer's finalizer costs more than copying a small reply. It never reads the whole directory: the window's engine opens from `ShiftBridge::encoded_directory`, which the workspace builds from the font it already holds (`EngineSession::directory`), so a window keeps no second native copy of the font. **WHY:** building the directory in the preload cost each CJK window about 220 MB of resident memory that never came back.

**Architecture Invariant:** Mutation echoes select complete renderer projections from `FontChangeSet::impact()`. The bridge translates those domain impacts into transport fields; it does not reconstruct transitive font coupling by matching individual change variants.

**Architecture Invariant:** The utility process calls the addon through four traits split by area, each a `#[pack::interface]` in `src/bridge/`: `NativeWorkspace` (open, save, close, persist, the font's records, and the dead native `apply`/`undo`/`redo` phase e deletes), `NativeAtlas` (Slug atlas generations and source catalog pages), `NativeSource` (a font file opened for browsing) and `NativeShaping` (the shaping tables). Each has one napi export, `<area>_request(method, numbers, blobs)`, which `reply::answer` decodes with the trait's `<trait>_request` and encodes the result of; names travel with each message (`pack::CarriedNames`). napi is the transport only: the generated `@shift/types/native-protocol` classes, built by `@shift/bridge`'s `createBridge`, are the API. **WHY:** One declaration per call, both sides generated, instead of a napi signature, a `shift-wire` twin and a scraped declaration per method.

**Architecture Invariant:** A trait method returns `Result<T, Native<Area>Error>`. Each variant carries the Rust error's text as `detail`, so the generated TypeScript throws a `PackError` whose `kind` names the failure (`noWorkspace`, `needsSaveAs`, `invalidInput`, `failed`, …) and whose message ends with the text callers saw before. Internally failures stay `BridgeError`; `through_bridge_error!` lets a trait method use `?` on anything `BridgeError` wraps.

**Architecture Invariant:** Values cross in pack's packed numbers: the `shift-wire` types derive `Pack` behind its `pack` feature, with `#[pack(id = …)]` typing a `String` id as its brand and `#[pack(numbers)]` sending glyph values as a `Float64Array`. Byte payloads (the encoded directory, persisted change sets, the shaper font) cross whole as `pack::Bytes` in the side blob list. An absent value reads as `null` in TypeScript.

**Architecture Invariant:** What the traits do not carry stays a napi method, exposed as `ShiftBridge.napi`: the Slug atlas streams (`ReadableStream<Buffer>`), the async export and specimen tasks, and the reads phase f moves into the window's engine (`getGlyphSnapshots`, `resolveLayers`, `getLayerMatch`, `getGlyphProjections`, `getGlyphPreviews`, `mapLocation`). Their DTOs are the remaining `shift-wire::bridges::napi` twins. `shift-bridge` and `shift-wire` are the only crates that may link the NAPI runtime — enforced by `scripts/check-invariants.py` (`napi-boundary`).

**Architecture Invariant:** Export explicitly acquires all persisted layers before taking a clone/COW `FontSaveSnapshot`. **WHY:** Async export gets a complete stable view while ordinary workspace open remains directory-first and lazy.

**Architecture Invariant:** Glyph snapshots, projections, imported `source.glyph`, and Slug preparation are explicit acquisition boundaries. Authored reads may load requested BLOBs in the serialized utility process; imported renderer Glyphs and synchronous getters never initiate I/O. `readFontSourceGlyph()` requests a stable session `GlyphId`, resolves the backend-private `GlyphIndex`, and returns canonical `GlyphSnapshot[]` for the root and complete component closure. Imported results contain projections but no authored layers. Product Grid startup requests the complete directory as bounded fixed root pages and presents only after the entire page set is resident.

**Architecture Invariant:** Rust/Fontdrasil constructs typed glyph, source-metric, and axis-mapping variation bases. The bridge translates compiled regions and vectors without inventing source identities, coefficients, sample order, or support regions; renderer code only evaluates those transport values. **WHY:** Per-location canvas work stays cheap without moving variation-model construction or value-layout ownership into transport code.

**Architecture Invariant:** `inspectDocument(path)` is read-only and may run without an open workspace. `openDocument(path, recoveryPath)` opens the canonical SQLite file directly against an app-owned sparse overlay; the bridge does not allocate or bind recovery paths. **WHY:** Electron must deduplicate by canonical document identity before selecting the one durable recovery allocation.

**Architecture Invariant:** A prepared Slug page remains native until it is consumed once through napi-rs `ReadableStream<Buffer>` chunks. Every font edit invalidates unconsumed output. The native producer has capacity one, and Electron acknowledges each GPU write before the utility reads another chunk. `slugAtlasCacheRevision()` exposes only the durable authored revision string needed by the utility's disposable cache key; cache bytes and policy remain outside Rust. **WHY:** Fixed pages yield between native calls, support narrow cached replacement after edits, and retain one bounded temporary chunk rather than an atlas-sized JavaScript copy or an unbounded IPC queue. The renderer installs the complete requested page set before presentation. The complete endpoint remains an external profiling boundary, not product startup scheduling.

## Codemap

```
crates/shift-bridge/
  src/
    lib.rs       -- crate root
    bridge.rs    -- `Bridge` NAPI class: the four request exports, the remaining napi methods, retained sources, export task
    bridge/
      workspace.rs -- `NativeWorkspace`: lifecycle, storage, persist, font records
      atlas.rs     -- `NativeAtlas`: Slug atlas generations and source catalog pages
      source.rs    -- `NativeSource`: a font file opened for browsing
      shaping.rs   -- `NativeShaping`: the compiled shaping tables
    reply.rs     -- one packed request over napi: read in place, reply blobs copied once
    config.rs    -- stateless config.toml and theme-file functions over shift-config, used by desktop main
    errors.rs    -- bridge error type and NAPI mapping
    input.rs     -- boundary parsing/adaptation helpers
    layer_reader.rs -- `LayerReader` NAPI class: shift-engine's `StoreReader` (layers, bases, composites) over a read-only store, for the renderer's preload
  scripts/
    profile-slug-atlas.mjs -- release source/native-document page and stream profiler
  Cargo.toml     -- cdylib crate; depends on shift-font, shift-wire, shift-backends, napi
```

## Key Types

- `Bridge` -- the exported `#[napi]` class holding the current `FontWorkspace` and document versions.
- `LayerId` -- mutation-side identity for the glyph layer being edited.
- `FontSaveSnapshot` -- clone/COW export view of the current workspace font.
- `DocumentIdentity` -- canonical `DocumentId` and canonical path used by utility/main document lifecycle decisions.
- `ExportFontTask` -- NAPI `Task` implementation for async font export.
- `BridgeError` -- typed bridge error enum converted once at the NAPI boundary.
- `AppliedChange` -- replace-grade mutation response returned by persist (and the dead apply/undo/redo).
- `FontReplacement` -- selective complete font projections, with the changed glyph records as `glyphChanges`; a collection is `null` when the edit left it alone.
- Intent payloads (`FontIntent` and each `*Intent`) are defined once in `shift_wire::intents`, transport-neutral, and derive `Pack` there.
- `UpdateFontMetadataIntent` -- complete authored metadata replacement payload that leaves metrics unchanged.
- `SetLanguagesIntent` / `LanguagesReplacement` -- tracked Hyperglot language list replacement stored in the font lib under `com.shift.languages`; the replacement wrapper's `languageIds` is `null` when the key is absent, so `getLanguageIds()` and the echo distinguish "no list" from an empty list.
- `AddComponentIntent` / `SetComponentTransformsIntent` / `RemoveComponentsIntent` / `DecomposeComponentsIntent` -- component-authoring payloads carrying stable layer, component, base-glyph, and decomposed-transform values through the shared atomic apply path.
- `NapiLayerReplaced` -- NAPI adapter for one replaced glyph layer in an applied change.
- `NapiAxis` / `NapiAxisMapping` -- authoring DTOs used by axis create/update, mapping replacement, and mapped-location queries.
- `NapiVariationBasis` / `NapiVariationDelta` -- compiled normalized supports and numeric contributions translated without model reconstruction.
- `NapiAxisMappingBasis` -- Fontdrasil-compiled mapping inputs, outputs, and normalized adjustment basis used for synchronous renderer evaluation.
- `NamedInstance` -- explicit product-preset DTO carrying stable identity and a complete external location.
- `NapiGlyphProjection` -- compact location-independent glyph backing with authored interpolation (plus a `decomposition` basis for glyphs compilers decompose) or imported `NapiGlyphVariation`, exact-source exceptions, and Rust-owned `GlyphComponents` relationships. Imported deltas remain numeric variation rather than fabricated authored sources. Every transported `ComponentGlyph` carries its parent-local `componentIndex` slot so the renderer correlates component transforms across compatible sources by ordered slot, never by authored `ComponentId`.
- `NapiLayerMatch` -- read-only, Rust-derived contour, point, anchor, and component identity pairs plus structural mismatch diagnostics. Incomplete matches carry no partial mappings.
- `NapiSourceMetricsInterpolationSnapshot` -- metric schema, reusable interpolation basis, and ordered source values projected from native source-metric interpolation; derived state, never `.shift` authoring data.
- `NapiSlugAtlas` -- small generation/page metadata, explicit authored root identities, exact-source selectors, deduplicated weight bases, cache-serialized preview extents, and aligned resident-section layout.
- `SlugAtlasGeneration` -- one aligned native atlas or page consumed by its stream API or released by its discard API.
- `slugAtlasCacheRevision()` -- utility-only durable authored revision key; it does not make cached Slug bytes canonical workspace state.

## How it works

1. The renderer resolves glyph state with `GlyphHandle + SourceId` and receives a stable `layerId`.
2. JS batches one or more `FontIntent` values (kind discriminator plus one populated payload field, e.g. "setContourClosed") into a single `apply(intents, label?)` call; the optional `label` string names the resulting undo ledger entry. `apply`, `undo`, and `redo` are the only font-mutation entry points — there are no per-mutation NAPI methods. `discardRedo()` only truncates unreachable ledger history and does not mutate font or dirty state.
3. `Bridge` converts each `shift_wire::intents::FontIntent` into shift-font's `FontIntent` with `TryFrom`, parsing boundary strings into typed IDs, and forwards the set as one atomic `FontWorkspace` apply: one SQLite transaction, one undo step.
4. The bridge returns a pure-state `NapiAppliedChange` — replaced layers, optional font-level replacement collections, and `dependents: Array<GlyphId>` naming the composite glyphs that reference the touched layers; no change records cross to the renderer — and bumps the live version. An edit that changes glyph records returns only the changed glyphs' records and the ids of glyphs it removed (`glyphChanges`), not the whole list, so renderer dependency edges follow apply, undo, and redo without resending every record of a large font.
5. Full glyph snapshots first acquire requested layer payloads, then include authored state plus the same `GlyphProjection` used by lightweight reads. `getGlyphProjections()` and previews expand transitive component identities through SQLite indexes, acquire those layers, and only then project without further I/O. `getLayerMatch()` validates same-glyph ownership, acquires that glyph, and transports the Rust-owned complete mappings or mismatch diagnostics without renderer caching. Source reads expose master sources only; layer-only/background sources remain native authoring details and never enter renderer interpolation.
6. `saveWorkspace()` applies a document's sparse recovery overlay to its canonical SQLite file. `saveWorkspaceAsDocument(path, recoveryPath)` publishes a new native document identity and adopts its fresh overlay; `discardWorkspaceChanges()` clears recovery and reloads canonical directory state.
7. `inspectDocument(path)` exposes canonical identity without opening a live workspace. `openDocument(path, recoveryPath)` opens merged lazy views selected by the utility process.
8. `closeWorkspace()` drops the live Rust workspace handle before the utility process removes clean or discarded recovery files and bindings.
9. `exportWorkspace(request)` creates a `FontSaveSnapshot` and exports asynchronously through `shift-backends`.
10. The renderer calls `prepareSlugAtlasPage(glyphIds, alignment)` for every deterministic fixed directory page and installs the complete set before first presentation. Every native miss independently acquires its indexed component closure. Closure traversal passes each complete deduplicated frontier to one bounded store query primitive; it never crosses SQLite once per root. Each bounded build uses one compilation-scoped `GlyphProjectionSet`; no projection or resolved-source map survives its build. The utility may bypass native preparation with a validated external `CachedAtlas` page keyed by canonical `DocumentId` for bound documents and app-local `workspaceId` for unbound documents. Cached and native pages share the same bounded renderer stream contract. Authored invalidation rebuilds every affected page while the previous complete set remains presented; scrolling performs no bridge work. The complete preparation endpoint remains available to the external profiler; set `SHIFT_PROFILE_SLUG_ATLAS=1` for native phase timings.

Imported (read-only) font sources go through `SourceIdentity`: opening a source mints stable glyph, axis, source, mapping, instance, and metric IDs once and retains the canonical `FontAxis` values plus the compiled `AxisMappingBasis` values for that directory. Imported per-source metrics (italic angle, line gap, underline, cap height, x-height) come from the backend directory rather than synthesized defaults. Catalog atlas coordinates arrive as external axis values and are mapped through the retained bases into design space before atlas weight evaluation, so external controls never leak into design-space interpolation. Authored mutations stay gated off while a read-only source is open.

## Slug atlas profiling

`profile-slug-atlas.mjs` detects native `.shift` input and exercises `openDocument(document, recovery)`, the same deterministic 256-root pages used by product startup, and each native stream. Other source formats retain the complete-atlas profiling path. `SHIFT_PROFILE_SLUG_ATLAS=1` additionally separates component closure, merged-view read/decode, font installation, atlas compilation, and layout without adding production timing DTOs.

On the Mini release build, OpenSans-CondensedItalic (3,431 glyphs, 3,063 components, 14 pages) reproduced the native regression as `openDocument` 113.177 ms and a cold page set of 18,514.129 ms; individual pages took 590.943–1,670.340 ms. Phase evidence isolated the first page to component closure 1,171.901 ms, merged-view read/decode 4.625 ms, and font installation 0.688 ms. Batching each graph frontier reduced the cold page set, including native streaming, to 292.668 ms; page preparation took 14.723–26.484 ms, page streaming 0.098–2.099 ms, and the subsequent complete page set took 234.859 ms. The real local macOS GPU application completed cold page preparation/stream/upload in 370.600 ms, first GPU completion in 3.300 ms, and launch-to-ready in 1,250.112 ms. A clean close/reopen loaded all 14 pages from the canonical-`DocumentId` cache, completed preparation/stream/upload in 26.600 ms, first GPU completion in 3.500 ms, and launch-to-ready in 623.000 ms. These values are profiler evidence, not CI thresholds; ordinary CI asserts graph work counts, cache origin, revision invalidation, and byte identity.

## Type Boundary

`scripts/types.mjs` runs one `cargo check` with both macros writing: napi-derive's declarations become `index.d.ts`, and the pack fragments become `protocol.ts` (`@shift/pack/generate`, shift-bridge's interfaces and every type they carry). `pnpm generate:bridge-types` then copies `protocol.ts` to `packages/types/src/bridge/protocol.ts` (exported as `@shift/types/native-protocol`) and derives `generated.ts` from `index.d.ts` for what is still a napi method. Neither is committed.

`dts-header.d.ts` is prepended to the napi-rs declaration output so generated signatures can reference branded IDs such as `PointId`, `ContourId`, `AxisLabelId`, `NamedInstanceId`, `LayerId`, and `SourceId` from `@shift/types`.

## Workflow recipes

### Adding a new mutation intent

1. Add the domain operation to the relevant model object in `shift-font`, exposed as a `FontIntent` variant.
2. Add or reuse a canonical DTO in `shift-wire`.
3. Add the intent payload struct in `shift-wire::intents` (`#[cfg_attr(feature = "pack", derive(pack::Pack))]`, `#[pack(id = …)]` on string ids, plus `serde::Deserialize`), add one line to the `wire_intents!` list, and implement `TryFrom<PayloadIntent> for font::FontIntent`, parsing string IDs with `parse`.
4. Do not add a per-intent method — every mutation flows through the single shared `apply` path.
5. Carry `LayerId` in the payload when the operation targets glyph outline state; the shared `apply` path returns the replacement state as `AppliedChange`.
6. Run `cargo check -p shift-bridge` and rebuild the native module before regenerating bridge types.

### Adding a new read-only query

1. Prefer committed font reads unless the method is explicitly asking for the currently focused renderer source.
2. Add it as a method of the area's trait in `src/bridge/`, returning a `Pack` type and the area's error; the TypeScript method appears on the next `pnpm generate:bridge-types`. Add no `#[napi]` method.
3. Keep editor/rendering concerns out of Rust; TypeScript owns canvas-specific interpretation.

All selected-glyph reads must stay location-independent. Do not add resolved SVG/path caches or location parameters: `readFontSourceGlyph()` returns retained fallback values, `GlyphVariation` deltas, exact-source shapes, and component dependencies. The renderer evaluates transported `AxisMappingBasis` and variation values synchronously. Never adapt imported deltas into `GlyphInterpolation` by fabricating `SourceId` values.

## Gotchas

- A typed id argument of a trait method (`GlyphId`, `LayerId`) crosses as its text and is read with `from_raw`, which does not validate it; an id an intent carries as a `String` is parsed through `parse::<PointId>` into a typed `invalidInput`. A remaining `#[napi]` method still parses through `input.rs`: a bare `.parse().unwrap()` there panics across the FFI boundary.
- An absent value crosses as `null`, never `undefined`: test it with `!= null` or `??`, not `!== undefined`.
- `index.d.ts` is generated output and is not committed (gitignored): hand edits are overwritten by the next native build or `types` run. `pnpm generate:bridge-types` refreshes it first through `shift-bridge#types` (`scripts/types.mjs`), which writes the same file from a `cargo check` in seconds instead of a release build: napi-derive's macros write each crate's definitions while they expand. That check uses its own target directory (`target/napi-types`), because napi-derive writes definitions only when `NAPI_TYPE_DEF_TMP_FOLDER` is set, and a check without it in a shared directory would leave a crate up to date with no fresh definitions.
- A new branded ID type used in a `#[napi]` signature must also be added to `dts-header.d.ts`, or the generated declarations reference a type TypeScript cannot resolve.
- The bridge never allocates recovery paths or decides which document address owns an overlay; putting that policy here can attach one recovery database to two live sessions.
- Mutations must go through the paths that call `mark_font_changed()`. Dirty/saved reporting comes from the workspace ledger via `workspace.is_dirty()`, not from the bridge's `live_version`/`saved_version` counters (written but never read), so what a skipped `mark_font_changed()` actually breaks is Slug invalidation: stale prepared Slug atlas output stays live, violating the contract that every font edit invalidates unconsumed output.
- A prepared Slug page is consume-once native state: streaming it twice, or after any font edit, fails by design. Do not cache the stream handle across edits — cache the consumed bytes (keyed by `slugAtlasCacheRevision()`) instead.
- `Float64Array` flat buffers appear only on outbound values (`LayerReplaced.values`, `GlyphState.values`). Inbound bulk coordinates (`MovePointsIntent`, `MoveAnchorsIntent`) cross as plain interleaved `Array<number>` today — do not assume typed arrays on input. When touching these paths, keep outbound reads in flat buffers; per-point objects reintroduce exactly the marshaling cost the flat-buffer invariant exists to avoid.
- NAPI locations are untyped `axisId -> value` maps. Wrap them into the typed external/design location exactly once at the boundary: external inputs get mapped once, and the output of `mapLocation()` must never be passed back in as if it were still external.

## Verification

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm --filter shift-bridge run build:debug
pnpm generate:bridge-types   # runs shift-bridge#types first
SHIFT_PROFILE_SLUG_ATLAS=1 node crates/shift-bridge/scripts/profile-slug-atlas.mjs /path/to/font.shift 10
```

## Related

- `shift-font` -- font/glyph/layer data model and model-level mutation logic.
- `shift-wire` -- canonical bridge DTOs (deriving `Pack`) and the remaining NAPI twins.
- `pack` / `@shift/pack` -- the packed encoding, the interface macro and the TypeScript generator.
- `shift-workspace` -- open editable font workspace and source/store coordination.
- `shift-backends` -- imported font loading and font export.
- `packages/types/src/bridge` -- generated TypeScript bridge facade.

# shift-bridge

<!-- reviewed: 2026-08-19 review-every: 90d -->

NAPI bindings that expose the Rust font engine to Node.js and Electron as a `Bridge` class.

## Architecture Invariants

**Architecture Invariant:** The bridge does not own hidden edit sessions or durable font state directly. It owns an optional `FontWorkspace` and forwards mutation transactions into `shift-workspace`. **WHY:** Renderer selection state stays in TypeScript, transport stays in `shift-bridge`, and workspace/store synchronization has one Rust owner.

**Architecture Invariant:** Public cross-process DTOs live in `shift-wire`; NAPI-specific wrappers for snapshots, projections, and Slug atlas values live under `shift-wire::bridges::napi`. `shift-bridge` only normalizes backend source data into those canonical types. **WHY:** Wire shapes remain independent of the native module implementation, while NAPI can still return efficient values such as `Float64Array`. `shift-bridge` and `shift-wire` are the only crates that may link the NAPI runtime — enforced by `scripts/check-invariants.py` (`napi-boundary`).

**Architecture Invariant:** Bridge methods return native NAPI values, not JSON strings. Domain failures flow through `BridgeError` and are converted at the NAPI boundary. **WHY:** Rust keeps typed errors internally, and TypeScript receives normal exceptions plus generated declaration types.

**Architecture Invariant:** Outbound bulk geometry (`NapiLayerReplaced` and `NapiGlyphState` `values`) crosses as `Float64Array` flat buffers plus typed node descriptors; inbound bulk position intents (`NapiMovePointsIntent`, `NapiMoveAnchorsIntent`) currently cross as plain interleaved `Array<number>` coords. **WHY:** Outbound snapshots keep the hot read path in flat numeric buffers while IDs remain branded strings at the API boundary.

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
    bridge.rs    -- `Bridge` NAPI class, workspace lifecycle, font reads, mutations, export task
    errors.rs    -- bridge error type and NAPI mapping
    input.rs     -- boundary parsing/adaptation helpers
  scripts/
    profile-slug-atlas.mjs -- release profiler through `Bridge.prepareSlugAtlas`
  Cargo.toml     -- cdylib crate; depends on shift-font, shift-wire, shift-backends, napi
```

## Key Types

- `Bridge` -- the exported `#[napi]` class holding the current `FontWorkspace` and document versions.
- `LayerId` -- mutation-side identity for the glyph layer being edited.
- `FontSaveSnapshot` -- clone/COW export view of the current workspace font.
- `NapiDocumentIdentity` -- canonical `DocumentId` and canonical path used by utility/main document lifecycle decisions.
- `ExportFontTask` -- NAPI `Task` implementation for async font export.
- `BridgeError` -- typed bridge error enum converted once at the NAPI boundary.
- `NapiAppliedChange` -- replace-grade mutation response returned by apply/undo/redo.
- `NapiFontReplacement` -- selective complete font projections; metadata is present only when an edit replaced it.
- `NapiUpdateFontMetadataIntent` -- complete authored metadata replacement payload that leaves metrics unchanged.
- `NapiLayerReplaced` -- NAPI adapter for one replaced glyph layer in an applied change.
- `NapiAxis` / `NapiAxisMapping` -- authoring DTOs used by axis create/update, mapping replacement, and mapped-location queries.
- `NapiVariationBasis` / `NapiVariationDelta` -- compiled normalized supports and numeric contributions translated without model reconstruction.
- `NapiAxisMappingBasis` -- Fontdrasil-compiled mapping inputs, outputs, and normalized adjustment basis used for synchronous renderer evaluation.
- `NapiNamedInstance` -- explicit product-preset DTO carrying stable identity and a complete external location.
- `NapiGlyphProjection` -- compact location-independent glyph backing with authored interpolation or imported `NapiGlyphVariation`, exact-source exceptions, and Rust-owned `GlyphComponents` relationships. Imported deltas remain numeric variation rather than fabricated authored sources. Every transported `ComponentGlyph` carries its parent-local `componentIndex` slot so the renderer correlates component transforms across compatible sources by ordered slot, never by authored `ComponentId`.
- `NapiSourceMetricsInterpolationSnapshot` -- metric schema, reusable interpolation basis, and ordered source values projected from native source-metric interpolation; derived state, never `.shift` authoring data.
- `NapiSlugAtlas` -- small generation/page metadata, explicit authored root identities, exact-source selectors, deduplicated weight bases, cache-serialized preview extents, and aligned resident-section layout.
- `SlugAtlasGeneration` -- one aligned native atlas or page consumed by its stream API or released by its discard API.
- `slugAtlasCacheRevision()` -- utility-only durable authored revision key; it does not make cached Slug bytes canonical workspace state.

## How it works

1. The renderer resolves glyph state with `GlyphHandle + SourceId` and receives a stable `layerId`.
2. JS batches one or more `NapiFontIntent` values (kind discriminator plus one populated payload field, e.g. "setContourClosed") into a single `apply(intents, label?)` call; the optional `label` string names the resulting undo ledger entry. `apply`, `undo`, and `redo` are the only mutation entry points — there are no per-mutation NAPI methods.
3. `Bridge` decodes each intent through `map_intent`, parsing boundary strings into typed IDs, and forwards the set as one atomic `FontWorkspace` apply: one SQLite transaction, one undo step.
4. The bridge returns a pure-state `NapiAppliedChange` — replaced layers, optional font-level replacement collections, and `dependents: Array<GlyphId>` naming the composite glyphs that reference the touched layers; no change records cross to the renderer — and bumps the live version.
5. Full glyph snapshots first acquire requested layer payloads, then include authored state plus the same `GlyphProjection` used by lightweight reads. `getGlyphProjections()` and previews expand transitive component identities through SQLite indexes, acquire those layers, and only then project without further I/O. Source reads expose master sources only; layer-only/background sources remain native authoring details and never enter renderer interpolation.
6. `saveWorkspace()` applies a document's sparse recovery overlay to its canonical SQLite file. `saveWorkspaceAsDocument(path, recoveryPath)` publishes a new native document identity and adopts its fresh overlay; `discardWorkspaceChanges()` clears recovery and reloads canonical directory state.
7. `inspectDocument(path)` exposes canonical identity without opening a live workspace. `openDocument(path, recoveryPath)` opens merged lazy views selected by the utility process.
8. `closeWorkspace()` drops the live Rust workspace handle before the utility process removes clean or discarded recovery files and bindings.
9. `exportWorkspace(request)` creates a `FontSaveSnapshot` and exports asynchronously through `shift-backends`.
10. The renderer calls `prepareSlugAtlasPage(glyphIds, alignment)` for every deterministic fixed directory page and installs the complete set before first presentation. Every native miss independently acquires its indexed component closure. Each bounded build uses one compilation-scoped `GlyphProjectionSet`; no projection or resolved-source map survives its build. The utility may bypass native preparation with a validated external `CachedAtlas` page keyed by `slugAtlasCacheRevision()`, but cached and native pages share the same bounded renderer stream contract. Authored invalidation rebuilds every affected page while the previous complete set remains presented; scrolling performs no bridge work. The complete preparation endpoint remains available to the external profiler; set `SHIFT_PROFILE_SLUG_ATLAS=1` for native phase timings.

Imported (read-only) font sources go through `SourceIdentity`: opening a source mints stable glyph, axis, source, mapping, instance, and metric IDs once and retains the canonical `FontAxis` values plus the compiled `AxisMappingBasis` values for that directory. Imported per-source metrics (italic angle, line gap, underline, cap height, x-height) come from the backend directory rather than synthesized defaults. Catalog atlas coordinates arrive as external axis values and are mapped through the retained bases into design space before atlas weight evaluation, so external controls never leak into design-space interpolation. Authored mutations stay gated off while a read-only source is open.

## Type Boundary

`crates/shift-bridge/index.d.ts` is generated by napi-rs from the NAPI wrappers. The root typegen script derives `packages/types/src/bridge/generated.ts` from that declaration file and removes `Napi*` prefixes for the TypeScript DTO facade.

`dts-header.d.ts` is prepended to the napi-rs declaration output so generated signatures can reference branded IDs such as `PointId`, `ContourId`, `AxisLabelId`, `NamedInstanceId`, `LayerId`, and `SourceId` from `@shift/types`.

## Workflow recipes

### Adding a new mutation intent

1. Add the domain operation to the relevant model object in `shift-font`, exposed as a `FontIntent` variant.
2. Add or reuse a canonical DTO in `shift-wire`.
3. Add the intent payload struct in `shift-wire::bridges::napi`, then extend `NapiFontIntent` with a new optional payload field and its `kind` discriminator value.
4. Add the matching `map_intent` branch in `bridge.rs`, parsing string IDs into typed IDs. Do not add a per-intent `#[napi]` method — every mutation flows through the single shared `apply` path.
5. Carry `LayerId` in the payload when the operation targets glyph outline state; the shared `apply` path returns the replacement state as `NapiAppliedChange`.
6. Run `cargo check -p shift-bridge` and rebuild the native module before regenerating bridge types.

### Adding a new read-only query

1. Prefer committed font reads unless the method is explicitly asking for the currently focused renderer source.
2. Return native NAPI DTOs rather than serialized JSON.
3. Keep editor/rendering concerns out of Rust; TypeScript owns canvas-specific interpretation.

All selected-glyph reads must stay location-independent. Do not add resolved SVG/path caches or location parameters: `readFontSourceGlyph()` returns retained fallback values, `GlyphVariation` deltas, exact-source shapes, and component dependencies. The renderer evaluates transported `AxisMappingBasis` and variation values synchronously. Never adapt imported deltas into `GlyphInterpolation` by fabricating `SourceId` values.

## Gotchas

- Every ID crosses the NAPI boundary as a string. Parse through `input.rs` (`parse::<PointId>(&value)`) so a malformed ID becomes a typed `BridgeError::InvalidInput`; a bare `.parse().unwrap()` inside a `#[napi]` method panics across the FFI boundary and takes the utility process down.
- `index.d.ts` is generated output — hand edits are overwritten by the next native build. The order matters: rebuild the addon with `pnpm --filter shift-bridge run build:debug` first, then run `pnpm generate:bridge-types`. Regenerating without rebuilding derives the TypeScript facade from a stale declaration file, which typechecks but lies.
- A new branded ID type used in a `#[napi]` signature must also be added to `dts-header.d.ts`, or the generated declarations reference a type TypeScript cannot resolve.
- The bridge never allocates recovery paths or decides which document address owns an overlay; putting that policy here can attach one recovery database to two live sessions.
- Mutations must go through the paths that call `mark_font_changed()`. Dirty/saved reporting comes from the workspace ledger via `workspace.is_dirty()`, not from the bridge's `live_version`/`saved_version` counters (written but never read), so what a skipped `mark_font_changed()` actually breaks is Slug invalidation: stale prepared Slug atlas output stays live, violating the contract that every font edit invalidates unconsumed output.
- A prepared Slug page is consume-once native state: streaming it twice, or after any font edit, fails by design. Do not cache the stream handle across edits — cache the consumed bytes (keyed by `slugAtlasCacheRevision()`) instead.
- `Float64Array` flat buffers appear only on outbound values (`NapiLayerReplaced.values`, `NapiGlyphState.values`). Inbound bulk coordinates (`NapiMovePointsIntent`, `NapiMoveAnchorsIntent`) cross as plain interleaved `Array<number>` today — do not assume typed arrays on input. When touching these paths, keep outbound reads in flat buffers; per-point objects reintroduce exactly the marshaling cost the flat-buffer invariant exists to avoid.
- NAPI locations are untyped `axisId -> value` maps. Wrap them into the typed external/design location exactly once at the boundary: external inputs get mapped once, and the output of `mapLocation()` must never be passed back in as if it were still external.

## Verification

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm --filter shift-bridge run build:debug
pnpm generate:bridge-types
SHIFT_PROFILE_SLUG_ATLAS=1 node crates/shift-bridge/scripts/profile-slug-atlas.mjs /path/to/font.shift 10
```

## Related

- `shift-font` -- font/glyph/layer data model and model-level mutation logic.
- `shift-wire` -- canonical bridge DTOs and NAPI adapters.
- `shift-workspace` -- open editable font workspace and source/store coordination.
- `shift-backends` -- imported font loading and font export.
- `packages/types/src/bridge` -- generated TypeScript bridge facade.

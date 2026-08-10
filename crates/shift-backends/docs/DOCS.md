# shift-backends

Font format backends that convert between on-disk font files and the `Font` IR used throughout the editor.

## Architecture Invariants

**Architecture Invariant:** Backends never expose format-specific types (`norad`, `glyphs-reader`) to callers. Authored conversion returns `shift-font` values; retained source reading returns a source-neutral `FontDirectory` plus location-independent `ProjectedGlyph` values without constructing authored objects. WHY: editing needs one authored model, while read-only inspection must not eagerly convert a complete source.

**Architecture Invariant:** `FontDirectory::from_font` is the sole projection from a format's canonical `shift-font::Font` header into retained metadata. Format adapters supply only ordered glyph names/Unicode values and retained geometry handles. Directory source order must match the source IDs used by retained layers, and sparse mapping coordinates are completed with the same axis-default/base semantics as the authored mapping model. WHY: separate format-specific directory builders silently lose metadata or misaddress source geometry.

**Architecture Invariant:** `FontReader` and `FontWriter` require `Send + Sync`. WHY: Backends are stored in `FontLoader` which lives inside the editor's shared state; they must be safe to use from multiple threads.

**Architecture Invariant:** Eager reader/writer backends are stateless unit structs. `OpenTypeFont` retains compiled bytes, `UfoFont` and `DesignspaceFont` retain their indexed GLIF payloads, and `GlyphsFont` retains one upstream-parsed source. Paths are provenance and error context only after open. A `FontImport` is a separate exhaustive bounded conversion cursor; OpenType sources intentionally expose no `FontImporter` capability. WHY: imported sessions must remain coherent and readable after the original path changes or disappears.

**Architecture Invariant:** `FontImport::report` describes valid source concepts whose semantics Shift converts, approximates, or omits. Malformed values and parser failures remain errors and never become import losses. WHY: authoring-fidelity limits such as Glyphs bracket layers must be visible without confusing unsupported source semantics with bad data.

**Architecture Invariant:** `UfoWriter` stages a complete UFO beside the destination and swaps it into place only after the staged tree is durable. WHY: a failed save must preserve the previous source rather than leave a partial directory.

**Architecture Invariant:** `UfoWriter` preserves fractional coordinates and widths. Empty contours are skipped because they have no serializable UFO geometry.

**Architecture Invariant:** Exporting a `Font` materialized from canonical SQLite must produce byte-identical UFO and Designspace artifacts to exporting the same supported in-memory `Font` directly. WHY: native persistence must preserve authored export inputs rather than narrowing them to a storage-specific projection.

**Architecture Invariant:** `GlyphsReader` converts Glyphs-format kerning group prefixes (`@MMK_L_`, `@MMK_R_`) to UFO-convention prefixes (`public.kern1.`, `public.kern2.`) at load time. WHY: The IR stores kerning in UFO conventions; all backends must normalize to this format.

**Architecture Invariant:** `GlyphsReader` only loads kerning from the default master and reports omitted non-default-master or RTL pairs through `ImportReport`. WHY: The IR currently stores a single static kerning table, not per-master or direction-specific kerning.

**Architecture Invariant:** TrueType export compiles an owned snapshot of the Shift `Font` IR directly through fontir/fontc. It must not serialize a temporary UFO or fall back to another authoring format. WHY: `.shift` is the canonical authoring source, and an intermediate format would discard or reinterpret Shift concepts before compilation.

**Architecture Invariant:** TTF/OTF, UFO, Designspace, and Glyphs streaming imports convert glyphs in bounded Rayon batches and preserve input order when publishing each batch. Eager readers drain those same canonical streams rather than maintaining a second conversion path. UFO and Designspace share `GlifGlyphStream`; Glyphs parses its source model once, publishes stable glyph identities, then releases owned Shift batches through `GlyphsGlyphStream`. Compiled VARC input is rejected before authored binary conversion begins; empty ordinary `glyf` records must never masquerade as blank imported VARC glyphs. SQLite remains outside this crate and is written by one workspace-owned sink. WHY: one conversion path prevents eager/streaming semantic drift, while concurrent SQLite authors would add contention and weaken transaction ownership.

**Architecture Invariant:** Compiled-font directories enumerate `maxp` glyph IDs, not only `cmap` mappings. Unencoded glyphs receive their `post`/CFF name or a synthesized `gidN` name. `GlyphIndex` is the dense backend-local GID and never crosses the native session boundary; the bridge maps it to an eager stable session `GlyphId`. WHY: `cmap` is character lookup, not the complete glyph directory.

**Architecture Invariant:** TrueType quadratic segments remain one `OffCurve` control plus one `QCurve` endpoint in the authored layer. Closing qcurve endpoints transfer their type to the wrapped start point. CFF cubic segments remain cubic. The bridge may project a qcurve endpoint as on-curve because clients infer the quadratic from its single control; canonical storage and source export retain the distinction. WHY: lifting every TrueType quadratic to cubic adds a point and derived coordinates to every segment, inflating canonical documents without adding information.

**Architecture Invariant:** Designspace source locations are complete design-space locations. An omitted source dimension resolves to that axis's mapped default; default-source selection compares against that complete location and never substitutes the first source. A `layer` attribute only selects outline storage. Selected-glyph acquisition compiles source layers into a fallback, compatible normalized deltas, and exact-source exceptions; location evaluation occurs later in TypeScript. WHY: mixing user defaults with design coordinates corrupts interpolation bases.

**Architecture Invariant:** `ProjectedGlyph` contains one requested root projection and a deduplicated complete transitive component closure. Each projection validates one fallback shape, optional normalized variation deltas, and incompatible exact-source shapes. Failed reads publish no partial aggregate and remain retryable. Empty and unmapped glyphs are valid projections with identity, metrics, and empty geometry. WHY: passive inspection and synchronous scrubbing need one coherent source-independent aggregate without hidden I/O.

**Architecture Invariant:** `shift-slug::retained` owns page compilation for every source. Projected sources expose `variable_glyph_inputs`, which the bridge passes to `compile_page`; `build_binary_atlas_page` streams ordered glyf/gvar or static CFF curves directly into the same Slug-owned `PageCompiler` without materializing projection descriptors or authored Shift geometry. Page-local OpenType regions are deduplicated, while each distinct glyph region set receives its own complement weight so unrelated tuple supports cannot alter that glyph's base geometry. Before packing, `into_parts` separates CPU atlas geometry from a small `SourceAtlasDescriptor`; the consumer then drops the geometry after packing while retaining the descriptor for glyph mapping and weight evaluation. Fixed pages are bounded compilation/transfer units, not viewport residency: the Grid consumer must install the complete page set before presentation. WHY: all formats must share one retained layout and validation path, while OpenType preserves its direct geometry path.

**Architecture Invariant:** Retained handles represent immutable source generations. Binary and GLIF sources own bytes; Glyphs owns its parsed source model. Projection and atlas reads never inspect the filesystem after open. WHY: directory metadata, lazy geometry, and component dependencies must always come from one coherent generation.

## Codemap

```
src/
  lib.rs             -- public backend and retained-source boundary
  format.rs          -- source format vocabulary
  import.rs          -- glyph-free source header and bounded conversion cursor
  import_report.rs   -- source-to-Shift fidelity losses
  font_source/
    mod.rs            -- FontSource/FontImporter split and OpenedFont dispatch
    types.rs          -- source-local indexes, directories, shapes, deltas, and projections
    projection.rs     -- shared master-model compilation and exact-source handling
    geometry.rs       -- source contour normalization for projections
    inputs.rs         -- projected glyphs -> shift-slug retained PageInput values
    atlas.rs          -- Slug retained-page aliases, validation, and source errors
  formats/
    opentype/
      source.rs       -- retained TTF/OTF bytes and GID access
      variable.rs     -- glyf/gvar variation extraction
      geometry.rs     -- direct curves, IUP deltas, and flattened components
      metrics.rs      -- HVAR or phantom-point advance contributions
      inputs.rs       -- direct streaming into retained::PageCompiler
      reader.rs       -- maxp-complete authored conversion stream
    ufo/              -- retained UFO source plus eager reader and atomic writer
    designspace/      -- retained Designspace source, mappings, reader, and writer
    glyphs/           -- retained Glyphs source, conversion stream, fidelity report, and reader
  shift2fontir/       -- owned Shift FontView -> fontir/fontc adapter
  export.rs           -- direct fontc TTF compilation and atomic output write
```

## Key Types

- `FontSource` -- immutable directory plus lazy `glyph(GlyphIndex) -> ProjectedGlyph` acquisition, implemented by every retained source handle
- `FontImporter` -- optional authored-conversion capability implemented by GLIF and Glyphs handles, but not binary handles
- `OpenedFont` -- dispatched `OpenType`, `Ufo`, `Designspace`, or `Glyphs` retained handle returned by `FontLoader::open_source`
- `FontDirectory` / `GlyphIndex` -- source-local immutable directory built by `FontDirectory::from_font`, with private fields, read-only accessors, and backend-local addressing
- `GlyphProjection` -- one fallback shape, optional normalized deltas, and exact-source topology exceptions
- `ProjectedGlyph` -- requested root projection plus its deduplicated transitive component projections
- `SourceAtlasPage` -- immutable source-indexed `VariableAtlas` page plus location-to-weight evaluation; its ordered roots contain no Shift IDs
- `SourceAtlasDescriptor` -- small mapping and weight evaluator retained after `SourceAtlasPage::into_parts` separates disposable CPU geometry
- `SourceAtlasError` -- direct atlas read, format-capability, and Slug construction failures
- `OpenTypeFont` / `UfoFont` / `DesignspaceFont` / `GlyphsFont` -- concrete retained source generations
- `FontImport` -- top-level authored header, an immediately publishable stable-ID/name directory, `ImportReport`, and layer-aware `next_batch(limit)`, with no glyphs stored in the header
- `ImportReport` / `ImportLoss` -- source concepts converted, approximated, or omitted because Shift cannot represent identical semantics; never malformed-data diagnostics
- `GlyphDirectoryEntry` -- cheap source glyph ID and name used before geometry batches are parsed
- `ImportBatchLimit` -- simultaneous glyph and authored-layer limits; multi-source projects cannot turn a glyph-count bound into an unbounded layer batch
- `FontReader` -- trait with `load(&self, path) -> Result<Font, String>` plus default methods for extracting glyphs, kerning, features from a loaded `Font`
- `FontWriter` -- trait with `save(&self, font, path) -> Result<(), String>`
- `FontBackend` -- auto-implemented marker trait for types implementing both `FontReader` + `FontWriter`
- `UfoReader` -- loads `.ufo` bundles via `norad`
- `UfoWriter` -- atomically writes `.ufo` bundles via `norad`
- `DesignspaceReader` / `DesignspaceWriter` -- read and atomically write `.designspace` projects plus companion UFOs, including continuous/discrete axes, axis value labels, per-axis maps, and cross-axis mappings
- `UfoBackend` -- unit struct implementing `FontBackend` by delegating to `UfoReader`/`UfoWriter`
- `GlyphsReader` -- eagerly drains the canonical `.glyphs` / `.glyphspackage` stream for compatibility callers; read-only (no writer)
- `GlyphsGlyphStream` -- owns one upstream-parsed Glyphs model and converts bounded, layer-aware Shift glyph batches in directory order
- `FontExporter` -- compiles a `FontView` directly to TTF via `ShiftIrSource` and fontc

## How it works

**Loading a font:** `FontLoader::open_source` dispatches TTF/OTF, UFO/Designspace, and Glyphs/Glyphspackage into immutable retained handles. Opening constructs the complete directory and retains source bytes or a parsed source model, but creates no authored `Font`, layer, point identity, or workspace. `FontSource::glyph` lazily parses/projects only the requested root and every transitive component dependency, with no location argument. `FontLoader::read_font` and `stream_font` remain separate explicit authored-conversion APIs.

**Point type mapping (read):** norad uses separate `Move`, `Line`, `Curve`, `OffCurve`, `QCurve` types. The IR collapses `Move`/`Line`/`Curve` into `OnCurve` and keeps `OffCurve` and `QCurve` distinct. On write, context (position in contour, open/closed, preceding point type) is used to reconstruct the correct norad variant.

**Multi-layer support:** `UfoReader` publishes `public.default` first, then preserves the relative authored order of every other entry in `layercontents.plist`. The default layer maps to the IR's default layer; other layers are represented by layer sources. Glyphs in non-default layers are merged into existing `Glyph` entries when the glyph already exists from another layer.

**Binary variation metadata:** The retained TTF/OTF handle exposes `fvar` axes and `avar` version 1 mappings in external/user coordinates. TrueType selected-glyph acquisition compiles `glyf`, `gvar`, and `HVAR` into fallback values plus normalized region deltas, preserving native point provenance, implied quadratic points, and affine composite transforms. Static CFF outlines compile cubic fallback shapes. Evaluation never reopens the source or calls Skrifa after acquisition. VARC retained projection remains a separate future capability from editable authored conversion; both boundaries currently reject it explicitly.

**Direct OpenType atlas:** `build_binary_atlas_page` reads raw glyf points and tuple regions from retained bytes. It applies IUP independently to each unscaled tuple, preserves a stable quadratic topology, flattens ordinary glyf components exactly, and combines HVAR or gvar phantom-point advance contributions with the same region weights. Curves stream directly into `shift_slug::retained::PageCompiler`; static CFF uses that compiler too. The page stores absolute region-peak curves because the retained atlas consumes weighted source values; a deduplicated complement weight makes every glyph's participating source weights sum to one. The consumer separates the atlas and descriptor with `into_parts`, packs and drops the former, and retains the latter. Axis updates evaluate fvar/avar 1 normalization and OpenType support scalars without touching geometry. Static CFF is supported; CFF2, cubic glyf extensions, avar version 2, and VARC remain explicit unsupported capabilities.

**Glyphs-format specifics:** `GlyphsReader` also extracts axes, sources, and per-master locations -- data that UFO does not natively represent. Kerning group membership is derived from per-glyph `right_kern`/`left_kern` fields and normalized to `public.kern1.*`/`public.kern2.*` conventions. Before conversion begins, `ImportReport` records bracket layers omitted because Shift has no conditional-layer model, intermediate and smart-component semantics approximated as ordinary layers/components, and non-default-master or RTL kerning omitted because Shift has one static table. The upstream parser currently materializes its complete normalized Glyphs source model before the bounded cursor begins; batching bounds Shift glyph conversion and persistence, not source-syntax parsing.

**Designspace mapping:** Per-axis `<map>` entries become independent `AxisMapping` values. Designspace 5.1+ `<mappings>` entries become the font's single cross-axis mapping group. Axis value labels use the standard Designspace 5.0 `<labels>` representation; imported labels receive newly minted Shift identity because Designspace has no equivalent stable label ID.

**Designspace conformance references:** The [Designspace XML source definition](https://fonttools.readthedocs.io/en/latest/designspaceLib/xml.html#source-element) defines source locations in design-space coordinates. The reference [`SourceDescriptor.getFullDesignLocation`](https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.SourceDescriptor.getFullDesignLocation) completes omitted dimensions with mapped axis defaults, and [`DesignSpaceDocument.findDefault`](https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.DesignSpaceDocument.findDefault) selects the source at that complete mapped default. Instance import follows the corresponding complete-location precedence and the reference continuous/discrete axis mapping behavior. Keep importer behavior and fixtures aligned with those APIs when extending Designspace support.

**Saving authoring sources:** `UfoWriter` builds a `norad::Font`, projects the default source's standard metrics, populates metadata/kerning/groups/guidelines/lib, and converts each glyph per layer. It writes the complete UFO to a sibling staging directory, syncs the tree, and atomically swaps it into place. `.shift` packages are written by `ShiftSourcePackage` through `FontLoader`.

**Compiling TTF:** `FontExporter` snapshots the supplied `FontView` into owned Shift values, creates fontir work for metadata, metrics, glyphs, anchors, features, and static kerning, and passes `ShiftIrSource` directly to `fontc::generate_font`. The returned bytes are atomically written to the requested `.ttf` path. Variable compilation converts Shift axes and independent mappings to fontdrasil coordinate converters, normalizes master source locations, and emits each authored glyph master. Missing non-default glyph layers are sparse masters; every glyph must have a default-source layer. Standard source metrics are emitted at every master location so fontc can build variable metric tables; kerning is currently static.

**Variable metadata:** Independent axis mappings compile to OpenType `avar` version 1. Axis labels compile to `STAT` axis values, including ranges, linked values, and elidable flags. Only explicit Shift `NamedInstance` values compile to `fvar`; source names are never inferred as products. The adapter maps complete external instance locations to fontir and lets compiler-only defaults and name IDs remain compiler concerns. Cross-axis mappings remain authored in Shift but direct TTF export rejects them until the compiler stack supports `avar` version 2.

## Workflow recipes

### Add a new read-only backend

1. Create `src/formats/<format>/mod.rs` and its reader/source modules.
2. Implement the appropriate authored `FontReader` and/or retained `FontSource` capability.
3. Export the format from `src/formats/mod.rs` and the public boundary from `lib.rs`.
4. Register dispatch in `src/font_loader.rs`.
5. Add extension mapping in `src/format.rs`.

### Add write support to an existing backend

1. Implement `FontWriter` on the backend struct
2. The `FontBackend` blanket impl kicks in automatically
3. Update `FontLoader::write_font` to allow the new format

### Modify point type conversion

1. Read conversion: `UfoReader::convert_point_type` (norad -> IR)
2. Write conversion: `UfoWriter::convert_point_type` (IR -> norad), which uses positional context
3. Run the `round_trip_ufo` test to verify fidelity
4. Run `writer_preserves_fractional_coordinates_and_skips_empty_contours` to check serialization

## Gotchas

- **Cross-platform UFO replacement:** macOS and Linux use an atomic directory exchange when supported. The fallback moves the old tree aside first and restores it if installing the staged tree fails.
- **OnCurve ambiguity on write:** The IR's `OnCurve` type is context-dependent when writing. The first point of an open contour becomes `Move`, a point after `OffCurve` becomes `Curve`, everything else becomes `Line`. If contour structure is malformed, this heuristic may produce wrong results.
- **Glyphs source parsing is eager:** `glyphs-reader` materializes one normalized source model before `GlyphsGlyphStream` starts. Shift geometry conversion, packing, compression, and SQLite writes remain bounded.
- **Glyphs kerning is default-master only:** Multi-master and RTL kerning are reduced to the default LTR table; omitted pairs are listed in `ImportReport`.
- **Cross-axis mappings:** Direct TTF compilation rejects cross-axis mappings until the compiler stack supports `avar` version 2. It never flattens the mapping or falls back to temporary UFO compilation.
- **Binary atlas capabilities:** Direct Grid compilation supports quadratic glyf/gvar plus HVAR or phantom advances and static CFF. CFF2, cubic glyf extensions, avar version 2, and VARC fail explicitly rather than falling back to another renderer or authored conversion.
- **Authored STAT tables:** When Shift axis labels exist, export appends a generated `STAT` feature block. If authored feature text also declares `STAT`, the feature compiler reports the conflict.

## Retained OpenType atlas profile

A controlled same-session release comparison on 2026-08-06 retained every packed Source Han Sans VF page to model complete Grid residency. Both the audited `d218d1ad` path and the Slug-owned streaming `PageCompiler` path produced byte-identical `267,786,324`-byte output with 5,489,581 base curves and 5,483,385 stored delta curves.

| Path                          | Complete build + pack | Page build p95 |
| ----------------------------- | --------------------: | -------------: |
| Audited `d218d1ad`            |        2,771–2,890 ms | 16.26–16.92 ms |
| Slug `PageCompiler` streaming |        2,679–2,687 ms | 15.25–15.36 ms |

The same-session comparison is authoritative; older absolute measurements used different runtime conditions. The streaming path preserves output while avoiding descriptor materialization. These are native compiler measurements; transfer, WebGPU upload, complete page-set installation, and first frame belong to desktop validation.

## Verification

```bash
# Run all backend tests (UFO round-trip, atomic writes, Glyphs loading, TTF export)
cargo test -p shift-backends

# Specific tests
cargo test -p shift-backends font_source --lib
cargo test -p shift-backends round_trip_ufo
cargo test -p shift-backends writer_preserves_fractional_coordinates_and_skips_empty_contours
cargo test -p shift-backends loads_homenaje_glyphs_file
cargo test -p shift-backends loads_glyphs_package
cargo test -p shift-backends --test export
cargo test -p shift-backends --test native_document_export

# Manual release profile: open/directory, selected projection,
# complete sequential/parallel projection, and peak RSS
cargo run -p shift-backends --release --example profile_font_source -- <font.ttf> [glyph-name]

# Complete location-independent binary atlas pages, packing, and retained bytes
cargo run -p shift-backends --release --example profile_binary_atlas -- <font.ttf>
```

## Related

- `Font`, `Glyph`, `GlyphLayer`, `Contour`, `PointType` -- IR types this crate converts to/from (shift-font)
- `FontLoader`, `FontAdaptor` -- shift-core dispatcher that selects backends by file extension
- `KerningData`, `KerningSide`, `KerningPair` -- IR kerning types that backends populate
- `FeatureData` -- IR feature storage, populated from `features.fea` or Glyphs feature snippets
- `LibData`, `LibValue` -- arbitrary plist data preserved through round-trips
- `Axis`, `Source`, `Location` -- designspace types populated by `GlyphsReader` for multi-master fonts

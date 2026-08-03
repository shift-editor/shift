# shift-backends

Font format backends that convert between on-disk font files and the `Font` IR used throughout the editor.

## Architecture Invariants

**Architecture Invariant:** Backends never expose format-specific types (`norad`, `glyphs-reader`) to callers. Authored conversion returns `shift-font` values; retained source reading returns source-neutral `FontDirectory` and `DisplayGlyph` values without constructing authored objects. WHY: editing needs one authored model, while read-only directory and selected-glyph access must not manufacture Shift identity or eagerly convert a complete source.

**Architecture Invariant:** `FontReader` and `FontWriter` require `Send + Sync`. WHY: Backends are stored in `FontLoader` which lives inside the editor's shared state; they must be safe to use from multiple threads.

**Architecture Invariant:** Eager reader/writer backends are stateless unit structs. `BinaryFont`, `GlifFont`, and `GlyphsFont` retain bytes, GLIF path indexes, or one upstream-parsed Glyphs source. A `FontImport` is an exhaustive bounded conversion cursor over that retained source and never owns a complete geometry-resident Shift `Font`. Binary sources intentionally expose no `FontImporter` capability. WHY: read-only access stays source-native and cheap, while explicit conversion remains bounded and uses original source semantics rather than display geometry.

**Architecture Invariant:** `UfoWriter` stages a complete UFO beside the destination and swaps it into place only after the staged tree is durable. WHY: a failed save must preserve the previous source rather than leave a partial directory.

**Architecture Invariant:** `UfoWriter` preserves fractional coordinates and widths. Empty contours are skipped because they have no serializable UFO geometry.

**Architecture Invariant:** `GlyphsReader` converts Glyphs-format kerning group prefixes (`@MMK_L_`, `@MMK_R_`) to UFO-convention prefixes (`public.kern1.`, `public.kern2.`) at load time. WHY: The IR stores kerning in UFO conventions; all backends must normalize to this format.

**Architecture Invariant:** `GlyphsReader` only loads kerning from the default master. WHY: The IR currently stores a single static kerning table, not per-master kerning.

**Architecture Invariant:** TrueType export compiles an owned snapshot of the Shift `Font` IR directly through fontir/fontc. It must not serialize a temporary UFO or fall back to another authoring format. WHY: `.shift` is the canonical authoring source, and an intermediate format would discard or reinterpret Shift concepts before compilation.

**Architecture Invariant:** TTF/OTF, UFO, Designspace, and Glyphs streaming imports convert glyphs in bounded Rayon batches and preserve input order when publishing each batch. Eager readers drain those same canonical streams rather than maintaining a second conversion path. UFO and Designspace share `GlifGlyphStream`; Glyphs parses its source model once, publishes stable glyph identities, then releases owned Shift batches through `GlyphsGlyphStream`. SQLite remains outside this crate and is written by one workspace-owned sink. WHY: one conversion path prevents eager/streaming semantic drift, while concurrent SQLite authors would add contention and weaken transaction ownership.

**Architecture Invariant:** Compiled-font streaming and random access enumerate `maxp` glyph IDs, not only `cmap` mappings. Unencoded glyphs receive their `post`/CFF name or a synthesized `gidN` name. `GlyphIndex` is the dense handle-local GID and is never converted to a Shift `GlyphId` for display; authored IDs are minted only if the legacy conversion stream is explicitly invoked. WHY: `cmap` is character lookup, not the complete glyph directory, and read-only display has no authored identity.

**Architecture Invariant:** Compiled-font contour and point identities are deterministic positions within one glyph's emitted outline: `contour_b{glyph-id-hex}_{contour-index-hex}` and `point_b{glyph-id-hex}_{point-index-hex}`. Counters are monotonic from zero; dropping an explicit closing endpoint does not reuse its consumed point index. WHY: compiled fonts have stable glyph/outline order but no Shift identities, and random IDs make equivalent re-imports differ while injecting incompressible entropy into canonical payloads.

**Architecture Invariant:** TrueType quadratic segments remain one `OffCurve` control plus one `QCurve` endpoint in the authored layer. Closing qcurve endpoints transfer their type to the wrapped start point. CFF cubic segments remain cubic. The bridge may project a qcurve endpoint as on-curve because clients infer the quadratic from its single control; canonical storage and source export retain the distinction. WHY: lifting every TrueType quadratic to cubic adds a point and derived coordinates to every segment, inflating canonical documents without adding information.

**Architecture Invariant:** Designspace source locations are imported as complete design-space locations. An omitted source dimension resolves to that axis's user-space default mapped into design space; default-source selection compares against that same completed mapped location and never silently substitutes the first source. A `layer` attribute only selects where a source's outlines live and does not make it ineligible to be the default. Each source's standard metrics are translated from that UFO's metric identities into the Designspace header definitions. Random access accepts external coordinates, applies independent and cross-axis mappings, then interpolates source geometry in design space. WHY: mixing user defaults with design coordinates corrupts interpolation bases, while looking up one UFO's metrics with another UFO's random IDs silently drops non-default master metrics.

**Architecture Invariant:** `DisplayGlyph` is a validated flat arena containing only one selected root and its component closure. Geometry, contour, component, point, anchor, and guide ranges form complete non-overlapping partitions; all geometry is reachable from root index zero. Coordinates use y-up design-space font units. Native TrueType points retain local point indexes and implied quadratic points are explicit unindexed on-curve values. WHY: drawing and passive inspection need one coherent source-independent value without recursive duplication, hidden I/O, or synthetic Shift IDs.

**Architecture Invariant:** `build_binary_atlas_page` compiles ordered glyf/gvar roots directly into a location-independent `SourceAtlasPage`; it never constructs `DisplayGlyph` or authored Shift geometry. Page-local OpenType regions are deduplicated, while each distinct glyph region set receives its own complement weight so unrelated tuple supports cannot alter that glyph's base geometry. Before packing, `into_parts` separates CPU atlas geometry from a small `SourceAtlasDescriptor`; the consumer then drops the geometry after packing while retaining the descriptor for glyph mapping and weight evaluation. Fixed pages are bounded compilation/transfer units, not viewport residency: the Grid consumer must install the complete page set before presentation. WHY: variable-axis frames and scrolling must perform no complete outline rebuild, source acquisition, geometry upload, or duplicate CPU atlas residency.

**Architecture Invariant:** Retained handles represent immutable source generations. Binary/Glyphs source stamps and GLIF manifests/selected paths are checked before reads; the first mismatch permanently returns the structured source-changed error from that handle. WHY: mixing directory data and geometry from different on-disk generations would produce incoherent display and conversion results.

## Codemap

```
src/
  lib.rs           -- re-exports FontReader, FontWriter, FontBackend, FontImport, and sub-modules
  import.rs        -- glyph-free foreign header, bounded cursor, and shared GLIF stream
  font_source/
    mod.rs          -- RandomAccessFont/FontImporter capability split and FontSource dispatch value
    types.rs        -- source-local indexes, directories, locations, and validated DisplayGlyph arenas
    geometry.rs     -- shared contour normalization, component-graph assembly, and exact bounds
    atlas.rs        -- source atlas page, location weights, region deduplication, and errors
    binary.rs       -- retained TTF/OTF bytes, GID access, glyf/gvar/CFF resolution
    binary/atlas.rs -- direct ordered glyf/gvar page compilation and source-to-atlas mapping
    binary/atlas/geometry.rs -- stable raw-point expressions, IUP deltas, and flattened composites
    binary/atlas/geometry/curves.rs -- normalized quadratic contours and Slug curve conversion
    binary/atlas/metrics.rs  -- HVAR or gvar phantom-point advance contributions
    glif.rs         -- retained UFO/Designspace manifests, paths, interpolation, and conversion cursor
    glyphs.rs       -- retained parsed Glyphs source, mappings, interpolation, and conversion cursor
    interpolation.rs -- source-location variation weights
    error.rs        -- structured source-read failures
  traits.rs        -- authored FontReader, FontWriter, FontBackend trait definitions
  ufo/
    mod.rs         -- UfoBackend convenience struct combining reader+writer; round-trip tests
    import.rs      -- UFO source discovery configured into the shared GLIF stream
    reader.rs      -- UfoReader eagerly drains the canonical UFO stream
    writer.rs      -- UfoWriter: shift_font::Font -> atomically written norad::Font
  glyphs/
    mod.rs         -- GlyphsReader and bounded stream exports; fixture-based integration tests
    conversion.rs  -- Glyphs header, glyph geometry, features, and kerning conversion
    import.rs      -- parsed Glyphs directory plus bounded parallel `GlyphsGlyphStream`
    reader.rs      -- eager compatibility reader that drains the canonical Glyphs stream
  designspace/
    import.rs      -- Designspace source discovery configured into the shared GLIF stream
  binary/
    reader.rs      -- maxp-complete TTF/OTF stream plus eager stream draining
  shift2fontir/
    source.rs      -- owned Shift FontView snapshot and fontir Source implementation
    axes.rs         -- Shift axis/mapping conversion and source normalization
    metadata.rs    -- static metadata, metrics, features, and empty color work
    stat.rs         -- axis-label conversion to STAT feature syntax
    glyph.rs       -- static/variable glyph, component, contour, and anchor work
    kerning.rs     -- static kerning group and pair work
  export.rs        -- direct fontc TTF compilation and atomic output write
```

## Key Types

- `RandomAccessFont` -- borrowed directory plus one-glyph-at-location resolution; implemented by all retained foreign handles
- `FontImporter` -- optional authored-conversion capability implemented by GLIF and Glyphs handles, but not binary handles
- `FontSource` -- dispatched `Binary`, `Glif`, or `Glyphs` retained handle returned by `FontLoader::open_source`
- `FontDirectory` / `GlyphIndex` / `VariationLocation` -- source-local immutable directory and validated external-coordinate addressing
- `DisplayGlyph` -- validated root/component closure in flat indexed arenas with exact bounds, metrics, anchors, guides, and point provenance
- `SourceAtlasPage` -- immutable source-indexed `VariableAtlas` page plus location-to-weight evaluation; its ordered roots contain no Shift IDs
- `SourceAtlasDescriptor` -- small mapping and weight evaluator retained after `SourceAtlasPage::into_parts` separates disposable CPU geometry
- `SourceAtlasError` -- direct atlas read, format-capability, and Slug construction failures
- `BinaryFont` / `GlifFont` / `GlyphsFont` -- concrete retained source generations
- `FontImport` -- top-level authored header, an immediately publishable stable-ID/name directory, and layer-aware `next_batch(limit)`, with no glyphs stored in the header
- `GlyphDirectoryEntry` -- cheap foreign glyph ID and name used before geometry batches are parsed
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

**Loading a font:** `FontLoader::open_source` dispatches TTF/OTF, UFO/Designspace, and Glyphs/Glyphspackage into retained random-access handles. Opening constructs a complete cheap directory but no authored `Font`, glyph, layer, contour, point identity, or workspace. `read_glyph` resolves only the requested root plus component closure at a validated external location. `FontLoader::read_font` retains the eager compatibility API, while `FontLoader::stream_font` dispatches explicit authored conversion. It first returns complete top-level metadata and a cheap glyph/source directory, then materializes at most the requested batch of `Glyph` values. UFO and Designspace both feed shared GLIF work records into `GlifGlyphStream`; Designspace only adds stable multi-source discovery. Glyphs syntax is parsed once by `glyphs-reader`; `GlyphsGlyphStream` preassigns every glyph identity so component references resolve before their bases are converted. Rayon converts geometry records in parallel; indexed collection preserves glyph order. The workspace writes and releases each Shift batch before requesting another.

**Point type mapping (read):** norad uses separate `Move`, `Line`, `Curve`, `OffCurve`, `QCurve` types. The IR collapses `Move`/`Line`/`Curve` into `OnCurve` and keeps `OffCurve` and `QCurve` distinct. On write, context (position in contour, open/closed, preceding point type) is used to reconstruct the correct norad variant.

**Multi-layer support:** `UfoReader` publishes `public.default` first, then preserves the relative authored order of every other entry in `layercontents.plist`. The default layer maps to the IR's default layer; other layers are represented by layer sources. Glyphs in non-default layers are merged into existing `Glyph` entries when the glyph already exists from another layer.

**Binary variation metadata:** The retained TTF/OTF handle exposes `fvar` axes in external/user coordinates and resolves selected glyphs at arbitrary valid locations. TrueType resolution applies `gvar` tuple scalars and IUP deltas, preserves native point indexes, inserts explicit implied quadratic points, and retains composite transforms as indexed geometry references. CFF outlines preserve cubic geometry with unindexed native provenance. The authored compatibility importer still materializes binary geometry only at the default location; recovering editable `gvar` masters remains separate work.

**Direct binary atlas:** `build_binary_atlas_page` reads raw glyf points and tuple regions from the retained bytes. It applies IUP independently to each unscaled tuple, preserves a stable quadratic topology, flattens ordinary glyf components exactly, and combines HVAR or gvar phantom-point advance contributions with the same region weights. The page stores absolute region-peak curves because `VariableAtlas` consumes weighted source values; a deduplicated complement weight makes every glyph's participating source weights sum to one. The consumer separates the atlas and descriptor with `into_parts`, packs and drops the former, and retains the latter. Axis updates evaluate fvar/avar 1 normalization and OpenType support scalars without touching geometry. CFF/CFF2, cubic glyf extensions, avar version 2, and VARC remain explicit unsupported capabilities in this first compiler slice.

**Glyphs-format specifics:** `GlyphsReader` also extracts axes, sources, and per-master locations -- data that UFO does not natively represent. Kerning group membership is derived from per-glyph `right_kern`/`left_kern` fields and normalized to `public.kern1.*`/`public.kern2.*` conventions. The upstream parser currently materializes its complete normalized Glyphs source model before the bounded cursor begins; batching bounds Shift glyph conversion and persistence, not source-syntax parsing.

**Designspace mapping:** Per-axis `<map>` entries become independent `AxisMapping` values. Designspace 5.1+ `<mappings>` entries become the font's single cross-axis mapping group. Axis value labels use the standard Designspace 5.0 `<labels>` representation; imported labels receive newly minted Shift identity because Designspace has no equivalent stable label ID.

**Designspace conformance references:** The [Designspace XML source definition](https://fonttools.readthedocs.io/en/latest/designspaceLib/xml.html#source-element) defines source locations in design-space coordinates. The reference [`SourceDescriptor.getFullDesignLocation`](https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.SourceDescriptor.getFullDesignLocation) completes omitted dimensions with mapped axis defaults, and [`DesignSpaceDocument.findDefault`](https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.DesignSpaceDocument.findDefault) selects the source at that complete mapped default. Instance import follows the corresponding complete-location precedence and the reference continuous/discrete axis mapping behavior. Keep importer behavior and fixtures aligned with those APIs when extending Designspace support.

**Saving authoring sources:** `UfoWriter` builds a `norad::Font`, projects the default source's standard metrics, populates metadata/kerning/groups/guidelines/lib, and converts each glyph per layer. It writes the complete UFO to a sibling staging directory, syncs the tree, and atomically swaps it into place. `.shift` packages are written by `ShiftSourcePackage` through `FontLoader`.

**Compiling TTF:** `FontExporter` snapshots the supplied `FontView` into owned Shift values, creates fontir work for metadata, metrics, glyphs, anchors, features, and static kerning, and passes `ShiftIrSource` directly to `fontc::generate_font`. The returned bytes are atomically written to the requested `.ttf` path. Variable compilation converts Shift axes and independent mappings to fontdrasil coordinate converters, normalizes master source locations, and emits each authored glyph master. Missing non-default glyph layers are sparse masters; every glyph must have a default-source layer. Standard source metrics are emitted at every master location so fontc can build variable metric tables; kerning is currently static.

**Variable metadata:** Independent axis mappings compile to OpenType `avar` version 1. Axis labels compile to `STAT` axis values, including ranges, linked values, and elidable flags. Only explicit Shift `NamedInstance` values compile to `fvar`; source names are never inferred as products. The adapter maps complete external instance locations to fontir and lets compiler-only defaults and name IDs remain compiler concerns. Cross-axis mappings remain authored in Shift but direct TTF export rejects them until the compiler stack supports `avar` version 2.

## Workflow recipes

### Add a new read-only backend

1. Create `src/<format>/mod.rs` and `src/<format>/reader.rs`
2. Implement `FontReader` for your struct -- the `load` method must return `Font`
3. Export from `lib.rs` with `pub mod <format>`
4. Register the new adaptor in `FontLoader::new()` in `shift-core/src/font_loader.rs`
5. Add the file extension mapping in `format_from_extension` in the same file

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
- **Glyphs kerning is default-master only:** Multi-master kerning is silently dropped to a single master's values.
- **Cross-axis mappings:** Direct TTF compilation rejects cross-axis mappings until the compiler stack supports `avar` version 2. It never flattens the mapping or falls back to temporary UFO compilation.
- **First binary atlas slice:** Direct Grid compilation supports quadratic glyf/gvar plus HVAR or phantom advances. CFF/CFF2, cubic glyf extensions, avar version 2, and VARC fail explicitly rather than falling back to selected-glyph or authored conversion.
- **Authored STAT tables:** When Shift axis labels exist, export appends a generated `STAT` feature block. If authored feature text also declares `STAT`, the feature compiler reports the conflict.

## Direct binary atlas profile

Release profiling on 2026-08-03 retained every packed page to model complete Grid residency. Source Han Sans VF compiled all 65,535 ordered roots into 256 fixed pages without `DisplayGlyph`, authored `Font`, or SQLite materialization:

```text
open + directory                         68.458 ms
location-independent page compilation 2,056.228 ms
packing all pages                       412.204 ms
complete build + pack                 2,469.520 ms
page build p50 / p95                   8.366 / 11.727 ms
all-page weight update                    0.071 ms
packed resident bytes                 267,786,324 (255.381 MiB)
maximum packed page                     1,813,572 (1.730 MiB)
peak RSS                                  315.9 MiB
base / stored delta curves       5,489,581 / 5,483,385
```

The 448-glyph Host Grotesk variable UI font compiled into two pages in 6.814 ms and packed in 0.953 ms, producing 481,448 bytes. Default, midpoint, and maximum-location simple/composite curves and advances match Skrifa's unrounded HarfBuzz-style glyf resolution within 0.001 font units. These are native compiler measurements; transfer, WebGPU upload, complete page-set installation, and first frame belong to the desktop follow-on.

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

# Manual release profile: open/directory, selected default/non-default,
# complete sequential/parallel binary resolution, and peak RSS
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

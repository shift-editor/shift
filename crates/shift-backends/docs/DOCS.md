# shift-backends

Font format backends that convert between on-disk font files and the `Font` IR used throughout the editor.

## Architecture Invariants

**Architecture Invariant:** All backends convert to/from `Font` (the shift-font representation), never exposing format-specific types (norad, glyphs-reader) to callers. WHY: The rest of the editor operates on a single IR; leaking format types would couple the editor to specific file formats.

**Architecture Invariant:** `FontReader` and `FontWriter` require `Send + Sync`. WHY: Backends are stored in `FontLoader` which lives inside the editor's shared state; they must be safe to use from multiple threads.

**Architecture Invariant:** Backends are stateless unit structs (no fields). WHY: They are pure converters with no caching or mutable state, making them trivially thread-safe and cheap to construct.

**Architecture Invariant:** `UfoWriter` stages a complete UFO beside the destination and swaps it into place only after the staged tree is durable. WHY: a failed save must preserve the previous source rather than leave a partial directory.

**Architecture Invariant:** `UfoWriter` preserves fractional coordinates and widths. Empty contours are skipped because they have no serializable UFO geometry.

**Architecture Invariant:** `GlyphsReader` converts Glyphs-format kerning group prefixes (`@MMK_L_`, `@MMK_R_`) to UFO-convention prefixes (`public.kern1.`, `public.kern2.`) at load time. WHY: The IR stores kerning in UFO conventions; all backends must normalize to this format.

**Architecture Invariant:** `GlyphsReader` only loads kerning from the default master. WHY: The IR currently stores a single static kerning table, not per-master kerning.

**Architecture Invariant:** TrueType export compiles an owned snapshot of the Shift `Font` IR directly through fontir/fontc. It must not serialize a temporary UFO or fall back to another authoring format. WHY: `.shift` is the canonical authoring source, and an intermediate format would discard or reinterpret Shift concepts before compilation.

## Codemap

```
src/
  lib.rs           -- re-exports FontReader, FontWriter, FontBackend, and sub-modules
  traits.rs        -- FontReader, FontWriter, FontBackend trait definitions
  ufo/
    mod.rs         -- UfoBackend convenience struct combining reader+writer; round-trip tests
    reader.rs      -- UfoReader: norad::Font -> shift_font::Font
    writer.rs      -- UfoWriter: shift_font::Font -> atomically written norad::Font
  glyphs/
    mod.rs         -- GlyphsReader re-export; fixture-based integration tests
    reader.rs      -- GlyphsReader: glyphs_reader::Font -> shift_font::Font (read-only)
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

- `FontReader` -- trait with `load(&self, path) -> Result<Font, String>` plus default methods for extracting glyphs, kerning, features from a loaded `Font`
- `FontWriter` -- trait with `save(&self, font, path) -> Result<(), String>`
- `FontBackend` -- auto-implemented marker trait for types implementing both `FontReader` + `FontWriter`
- `UfoReader` -- loads `.ufo` bundles via `norad`
- `UfoWriter` -- atomically writes `.ufo` bundles via `norad`
- `DesignspaceReader` / `DesignspaceWriter` -- read and atomically write `.designspace` projects plus companion UFOs, including continuous/discrete axes, axis value labels, per-axis maps, and cross-axis mappings
- `UfoBackend` -- unit struct implementing `FontBackend` by delegating to `UfoReader`/`UfoWriter`
- `GlyphsReader` -- loads `.glyphs` and `.glyphspackage` files via `glyphs-reader`; read-only (no writer)
- `FontExporter` -- compiles a `FontView` directly to TTF via `ShiftIrSource` and fontc

## How it works

**Loading a font:** `FontLoader` (in shift-core) dispatches by file extension to the appropriate backend. The backend reads the file using a format-specific library (`norad` for UFO, `glyphs-reader` for Glyphs), then walks the parsed data to build a `Font`. This involves converting point types, contours, components, anchors, guidelines, kerning groups/pairs, OpenType features, and lib data into their IR equivalents.

**Point type mapping (read):** norad uses separate `Move`, `Line`, `Curve`, `OffCurve`, `QCurve` types. The IR collapses `Move`/`Line`/`Curve` into `OnCurve` and keeps `OffCurve` and `QCurve` distinct. On write, context (position in contour, open/closed, preceding point type) is used to reconstruct the correct norad variant.

**Multi-layer support:** `UfoReader` iterates all norad layers. The `public.default` layer maps to the IR's default layer; other layers are added via `Font::add_layer`. Glyphs in non-default layers are merged into existing `Glyph` entries when the glyph already exists from another layer.

**Glyphs-format specifics:** `GlyphsReader` also extracts axes, sources, and per-master locations -- data that UFO does not natively represent. Kerning group membership is derived from per-glyph `right_kern`/`left_kern` fields and normalized to `public.kern1.*`/`public.kern2.*` conventions.

**Designspace mapping:** Per-axis `<map>` entries become independent `AxisMapping` values. Designspace 5.1+ `<mappings>` entries become the font's single cross-axis mapping group. Axis value labels use the standard Designspace 5.0 `<labels>` representation; imported labels receive newly minted Shift identity because Designspace has no equivalent stable label ID.

**Saving authoring sources:** `UfoWriter` builds a `norad::Font`, populates metadata/metrics/kerning/groups/guidelines/lib, and converts each glyph per layer. It writes the complete UFO to a sibling staging directory, syncs the tree, and atomically swaps it into place. `.shift` packages are written by `ShiftSourcePackage` through `FontLoader`.

**Compiling TTF:** `FontExporter` snapshots the supplied `FontView` into owned Shift values, creates fontir work for metadata, metrics, glyphs, anchors, features, and static kerning, and passes `ShiftIrSource` directly to `fontc::generate_font`. The returned bytes are atomically written to the requested `.ttf` path. Variable compilation converts Shift axes and independent mappings to fontdrasil coordinate converters, normalizes master source locations, and emits each authored glyph master. Missing non-default glyph layers are sparse masters; every glyph must have a default-source layer. Shift's font-wide metrics and kerning remain constant across the variable font.

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
- **Glyphs kerning is default-master only:** Multi-master kerning is silently dropped to a single master's values.
- **Cross-axis mappings:** Direct TTF compilation rejects cross-axis mappings until the compiler stack supports `avar` version 2. It never flattens the mapping or falls back to temporary UFO compilation.
- **Authored STAT tables:** When Shift axis labels exist, export appends a generated `STAT` feature block. If authored feature text also declares `STAT`, the feature compiler reports the conflict.

## Verification

```bash
# Run all backend tests (UFO round-trip, atomic writes, Glyphs loading, TTF export)
cargo test -p shift-backends

# Specific tests
cargo test -p shift-backends round_trip_ufo
cargo test -p shift-backends writer_preserves_fractional_coordinates_and_skips_empty_contours
cargo test -p shift-backends loads_homenaje_glyphs_file
cargo test -p shift-backends loads_glyphs_package
cargo test -p shift-backends --test export
```

## Related

- `Font`, `Glyph`, `GlyphLayer`, `Contour`, `PointType` -- IR types this crate converts to/from (shift-font)
- `FontLoader`, `FontAdaptor` -- shift-core dispatcher that selects backends by file extension
- `KerningData`, `KerningSide`, `KerningPair` -- IR kerning types that backends populate
- `FeatureData` -- IR feature storage, populated from `features.fea` or Glyphs feature snippets
- `LibData`, `LibValue` -- arbitrary plist data preserved through round-trips
- `Axis`, `Source`, `Location` -- designspace types populated by `GlyphsReader` for multi-master fonts

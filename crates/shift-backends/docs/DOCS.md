# shift-backends

Font format backends that convert between on-disk font files and the `Font` IR used throughout the editor.

## Architecture Invariants

**Architecture Invariant:** All backends convert to/from `Font` (the shift-ir representation), never exposing format-specific types (norad, glyphs-reader) to callers. WHY: The rest of the editor operates on a single IR; leaking format types would couple the editor to specific file formats.

**Architecture Invariant:** `FontReader` and `FontWriter` require `Send + Sync`. WHY: Backends are stored in `FontLoader` which lives inside the editor's shared state; they must be safe to use from multiple threads.

**Architecture Invariant:** Backends are stateless unit structs (no fields). WHY: They are pure converters with no caching or mutable state, making them trivially thread-safe and cheap to construct.

**CRITICAL:** `UfoWriter::save` calls `remove_dir_all` on the target path before writing. This is a destructive overwrite -- if the save fails partway through, the previous file is already gone. Callers must handle save errors with this in mind (e.g. write to a temp path first, then rename).

**Architecture Invariant:** The `UfoWriter` rounds all coordinates and widths to integers via the `UfoRound` trait (calls `f64::round()`). WHY: UFO files conventionally store integer coordinates; sub-unit precision is discarded on save. Empty contours are also skipped on write.

**Architecture Invariant:** `GlyphsReader` converts Glyphs-format kerning group prefixes (`@MMK_L_`, `@MMK_R_`) to UFO-convention prefixes (`public.kern1.`, `public.kern2.`) at load time. WHY: The IR stores kerning in UFO conventions; all backends must normalize to this format.

**Architecture Invariant:** `GlyphsReader` only loads kerning from the default master. WHY: The IR currently stores a single static kerning table, not per-master kerning.

## Codemap

```
src/
  lib.rs           -- re-exports FontReader, FontWriter, FontBackend, and sub-modules
  traits.rs        -- FontReader, FontWriter, FontBackend trait definitions
  ufo/
    mod.rs         -- UfoBackend convenience struct combining reader+writer; round-trip tests
    reader.rs      -- UfoReader: norad::Font -> shift_ir::Font
    writer.rs      -- UfoWriter: shift_ir::Font -> norad::Font (with coordinate rounding)
  glyphs/
    mod.rs         -- GlyphsReader re-export; fixture-based integration tests
    reader.rs      -- GlyphsReader: glyphs_reader::Font -> shift_ir::Font (read-only)
```

## Key Types

- `FontReader` -- trait with `load(&self, path) -> Result<Font, String>` plus default methods for extracting glyphs, kerning, features from a loaded `Font`
- `FontWriter` -- trait with `save(&self, font, path) -> Result<(), String>`
- `FontBackend` -- auto-implemented marker trait for types implementing both `FontReader` + `FontWriter`
- `UfoReader` -- loads `.ufo` bundles via `norad`
- `UfoWriter` -- writes `.ufo` bundles via `norad`; rounds coordinates to integers
- `UfoBackend` -- unit struct implementing `FontBackend` by delegating to `UfoReader`/`UfoWriter`
- `GlyphsReader` -- loads `.glyphs` and `.glyphspackage` files via `glyphs-reader`; read-only (no writer)

## How it works

**Loading a font:** `FontLoader` (in shift-core) dispatches by file extension to the appropriate backend. The backend reads the file using a format-specific library (`norad` for UFO, `glyphs-reader` for Glyphs), then walks the parsed data to build a `Font`. This involves converting point types, contours, components, anchors, guidelines, kerning groups/pairs, OpenType features, and lib data into their IR equivalents.

**Point type mapping (read):** norad uses separate `Move`, `Line`, `Curve`, `OffCurve`, `QCurve` types. The IR collapses `Move`/`Line`/`Curve` into `OnCurve` and keeps `OffCurve` and `QCurve` distinct. On write, context (position in contour, open/closed, preceding point type) is used to reconstruct the correct norad variant.

**Multi-layer support:** `UfoReader` iterates all norad layers. The `public.default` layer maps to the IR's default layer; other layers are added via `Font::add_layer`. Glyphs in non-default layers are merged into existing `Glyph` entries when the glyph already exists from another layer.

**Glyphs-format specifics:** `GlyphsReader` also extracts axes, sources, and per-master locations -- data that UFO does not natively represent. Kerning group membership is derived from per-glyph `right_kern`/`left_kern` fields and normalized to `public.kern1.*`/`public.kern2.*` conventions.

**Saving:** Only UFO write is supported. `UfoWriter` builds a `norad::Font`, populates metadata/metrics/kerning/groups/guidelines/lib, then converts each glyph per layer. `features.fea` is written as a standalone file before calling `norad::Font::save`.

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
4. Run `writer_rounds_coordinates_and_skips_empty_contours` to check formatting

## Gotchas

- **Destructive save:** `UfoWriter::save` deletes the entire target directory before writing. A crash mid-save means data loss. No atomic-rename strategy is in place yet.
- **Coordinate rounding:** All coordinates are rounded to nearest integer on UFO write. If you need sub-unit precision preserved, this will silently discard it.
- **OnCurve ambiguity on write:** The IR's `OnCurve` type is context-dependent when writing. The first point of an open contour becomes `Move`, a point after `OffCurve` becomes `Curve`, everything else becomes `Line`. If contour structure is malformed, this heuristic may produce wrong results.
- **Glyphs kerning is default-master only:** Multi-master kerning is silently dropped to a single master's values.
- **features.fea written before norad save:** The writer creates the output directory and writes `features.fea` before calling `norad_font.save()`. If the path already existed, it was already deleted by `remove_dir_all`, so the directory is recreated for the .fea file.

## Verification

```bash
# Run all backend tests (UFO round-trip, coordinate rounding, Glyphs loading)
cargo test -p shift-backends

# Specific tests
cargo test -p shift-backends round_trip_ufo
cargo test -p shift-backends writer_rounds_coordinates_and_skips_empty_contours
cargo test -p shift-backends loads_homenaje_glyphs_file
cargo test -p shift-backends loads_glyphs_package
```

## Related

- `Font`, `Glyph`, `GlyphLayer`, `Contour`, `PointType` -- IR types this crate converts to/from (shift-ir)
- `FontLoader`, `FontAdaptor` -- shift-core dispatcher that selects backends by file extension
- `KerningData`, `KerningSide`, `KerningPair` -- IR kerning types that backends populate
- `FeatureData` -- IR feature storage, populated from `features.fea` or Glyphs feature snippets
- `LibData`, `LibValue` -- arbitrary plist data preserved through round-trips
- `Axis`, `Source`, `Location` -- designspace types populated by `GlyphsReader` for multi-master fonts

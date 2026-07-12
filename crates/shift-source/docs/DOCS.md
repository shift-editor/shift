# shift-source

Source-package crate for Shift's user-authored `.shift` format.

## Architecture Invariants

- **Architecture Invariant:** `.shift` is a single zip file containing deterministic JSON entries. `manifest.json` is stored uncompressed as the first zip entry.
- **Architecture Invariant:** Every `.shift` manifest carries a stable `packageId`. Filesystem moves and byte-for-byte copies preserve it; Save As mints a new one.
- **Architecture Invariant:** This crate owns the stable source schema DTOs and converts to/from `shift_font::Font`. It does not expose serde for private `shift-font` storage structs as the file contract.
- **Architecture Invariant:** Serialization is tree-first: `font_to_tree` emits `Vec<(path, bytes)>`; `write_tree_atomic` is the zip container layer. A future loose-directory container can reuse the same tree schema.
- **Architecture Invariant:** `.shift` is separate from the app-managed SQLite working store. SQLite import/export wiring belongs in `shift-workspace`, not here.

## Codemap

```text
crates/shift-source/src/
  lib.rs      -- public API barrel
  package.rs  -- DTOs, tree serialization, zip IO, package validation
```

## Key Types

- `ShiftSourcePackage` -- opened or newly written `.shift` zip file.
- `PackageId` -- stable package identity stored in `manifest.json`.
- `SourcePackageError` -- typed package IO, zip, JSON, schema, and conversion failures.
- `PackageTree` -- deterministic file tree as `(path, bytes)` entries.

## Package Shape

```text
Family.shift
  manifest.json
  font.json
  axes.json
  axis-mappings.json
  sources.json
  features.fea                    # optional verbatim OpenType feature text
  kerning.json                    # optional, glyph references use stable glyph ids
  glyphs/
    <glyphId>.json
  modules/
    shift.libData.json            # optional Shift-owned compatibility module for IR lib data
```

`glyphs/<glyphId>.json` must contain the same `id`; a mismatch is a load error.

## Implemented Source Contract

This crate implements the compact v1 source package contract used by the app
and `FontLoader`:

- `axis_*`, `axisMapping_*`, `source_*`, `glyph_*`, and layer/component IDs are stable identity.
- Axis tags and glyph names are labels. They are written for humans and
  external format interop, but they are not reference keys.
- `axes.json` stores each axis `id` plus its OpenType `tag`, name, role,
  continuous/discrete kind, axis value labels, and hidden flag.
- `axis-mappings.json` stores the ordered font-owned independent mappings and
  optional cross-axis mapping group using stable axis IDs.
- `sources.json` stores source locations as `axisId -> design-space value`.
- Each glyph file is `glyphs/<glyphId>.json`; glyph layers are keyed by
  `sourceId`.
- Components store `baseGlyphId` as the canonical reference and
  `baseGlyphName` as a label cache.
- Load rejects non-finite metrics/coordinates/transforms/location values,
  invalid axis ranges, mismatched glyph file IDs, dangling source/layer/axis
  references, and component base caches that do not match the referenced glyph.

Font-level guidelines live in `font.json`. Layer guidelines live in the owning
`glyphs/<glyphId>.json` entry so a future loose-directory writer can still keep
guideline edits narrow.

`features.fea` is stored as text, not JSON, and is absent when the font has no
feature source.

`kerning.json` stores kerning pairs and groups with stable glyph IDs plus glyph
names as label caches. The serializer rejects kerning that references a glyph
name that cannot resolve to a current glyph ID, because `.shift` references must
not become name-keyed source truth.

Current `shift_font::LibData` is preserved in `modules/shift.libData.json`, a
Shift-owned, schema-versioned module. Core font/glyph/layer JSON documents do
not grow arbitrary `lib` fields.

## How it works

`font_to_tree(font)` converts the live `Font` projection into deterministic JSON entries. `tree_to_font(tree)` validates the manifest and rebuilds a `Font` through public `shift-font` constructors and mutators.

`ShiftSourcePackage::save_font(path, font)` writes `path.tmp`, syncs it, then atomically renames it to `path`. `ShiftSourcePackage::load_font(path)` reads the zip tree and returns a rebuilt `Font`.

`ShiftSourcePackage::save_font(path, font)` preserves the package id when `path` already contains a valid `.shift` package. `ShiftSourcePackage::save_font_as(path, font)` always mints a new package id for Save As semantics.

`ShiftSourcePackage::create_empty(path)` writes an empty default `Font` package and refuses to overwrite an existing path.

## Backend Integration

`shift-source` intentionally does not depend on `shift-backends`. `shift-backends`
owns the `FontLoader` adaptor that delegates `.shift` reads and writes to
`ShiftSourcePackage::load_font` and `ShiftSourcePackage::save_font`.

## Verification

```bash
cargo fmt --all --check
cargo test -p shift-source
```

## Related

- `shift-font` -- live authoring model converted at the boundary.
- `shift-backends` -- extension-dispatch layer that can register `.shift` as a font backend.
- `shift-workspace` -- composes source package IO with the SQLite working store.

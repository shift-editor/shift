# shift-source

<!-- reviewed: 2026-08-18 review-every: 90d -->

Source-package crate for Shift's user-authored `.shift` format.

## Architecture Invariants

- **Architecture Invariant:** `.shift` is a single zip file containing deterministic JSON entries. `manifest.json` is stored uncompressed as the first zip entry.
- **Architecture Invariant:** Every `.shift` manifest carries a stable `packageId`. Filesystem moves and byte-for-byte copies preserve it; Save As mints a new one.
- **Architecture Invariant:** This crate owns the stable source schema DTOs and converts to/from `shift_font::Font`. It does not expose serde for private `shift-font` storage structs as the file contract.
- **Architecture Invariant:** Serialization is tree-first: `font_to_tree` emits `Vec<(path, bytes)>`; `write_tree_atomic` is the zip container layer. A future loose-directory container can reuse the same tree schema.
- **Architecture Invariant:** Deterministic serialization must preserve domain order. Ordered entities are encoded as JSON arrays containing their stable IDs; sorted JSON objects are reserved for dictionaries whose order has no authoring meaning.
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
  instances.json
  sources.json
  features.fea                    # optional verbatim OpenType feature text
  kerning.json                    # optional, glyph references use stable glyph ids
  glyphs/
    <glyphId>.json
  modules/
    shift.libData.json            # optional Shift-owned compatibility module for IR lib data
    shift.fontInfo.json           # optional Shift-owned module for preserved fontinfo remainder fields
  data/
    <path>                        # optional verbatim binary data files
  images/
    <path>                        # optional verbatim image files
```

`glyphs/<glyphId>.json` must contain the same `id`; a mismatch is a load error.

## Implemented Source Contract

This crate implements the compact v1 source package contract used by the app
and `FontLoader`:

- `axis_*`, `axisLabel_*`, `axisMapping_*`, `namedInstance_*`, `source_*`, `glyph_*`, and layer/component IDs are stable identity.
- Axis tags and glyph names are labels. They are written for humans and
  external format interop, but they are not reference keys.
- `axes.json` stores each axis `id` plus its OpenType `tag`, name, role,
  continuous/discrete kind, stable-ID external axis value labels, and hidden flag.
- `axis-mappings.json` stores the ordered font-owned independent mappings and
  optional cross-axis mapping group using stable axis IDs.
- `instances.json` stores explicit named product presets. Every location is a
  complete `axisId -> external value` map; instances do not reference sources
  and do not store Designspace or compiler fields.
- `font.json` stores global UPM, ordered stable-ID metric definitions, and the glyph order for the independently stored glyph files.
- `sources.json` stores source locations as `axisId -> design-space value`, plus values and overshoots keyed by `metricId` and optional source technical metrics.
- Each glyph file is `glyphs/<glyphId>.json`; glyph layers are keyed by
  `sourceId`.
- Components are an ordered array containing stable component identity,
  `baseGlyphId` as the canonical reference, and `baseGlyphName` as a label
  cache. Component order participates in rendering and interpolation
  compatibility.
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
not grow arbitrary `lib` fields. Nested `LibValue::Dict` values round-trip
through ordered maps on load as well as save, so a load/save cycle is
byte-stable.

## How it works

`font_to_tree(package_id, font)` converts the live `Font` projection into deterministic JSON entries. `tree_to_font(tree)` validates the manifest and rebuilds a `Font` through public `shift-font` constructors and mutators.

Locations become typed at the conversion boundary: named-instance locations are rebuilt as `ExternalLocation` values and source locations as `DesignLocation` values, so the external/design distinction is enforced from load rather than trusted downstream.

`ShiftSourcePackage::save_font(path, font)` writes `path.tmp`, syncs it, then atomically renames it to `path`. `ShiftSourcePackage::load_font(path)` reads the zip tree and returns a rebuilt `Font`.

`ShiftSourcePackage::save_font(path, font)` preserves the package id when `path` already contains a valid `.shift` package. `ShiftSourcePackage::save_font_as(path, font)` always mints a new package id for Save As semantics.

`ShiftSourcePackage::create_empty(path)` writes an empty default `Font` package and refuses to overwrite an existing path.

## Backend Integration

`shift-source` intentionally does not depend on `shift-backends`. `shift-backends`
owns the `FontLoader` adaptor that delegates `.shift` reads and writes to
`ShiftSourcePackage::load_font` and `ShiftSourcePackage::save_font`.

## Workflow recipes

### Adding a field to an existing document

1. Add the field to the private doc struct in `package.rs` (`FontDoc`, `SourceDoc`, `LayerDoc`, …) with `#[serde(default)]` or an `Option` so packages written before the change still load.
2. Update both conversion directions: the `TryFrom` from the `shift_font` model into the doc, and the doc back into the model. `tree_to_font` must rebuild state through public `shift-font` constructors and mutators only — never by exposing private storage serde.
3. If the field is an ordered authoring collection, encode it as a JSON array carrying stable IDs. Sorted JSON objects are only for dictionaries whose order carries no authoring meaning.
4. Extend the round-trip coverage in `crates/shift-source/tests/package_test.rs` so save → load reproduces the value exactly.
5. Verify: `cargo test -p shift-source`.

### Adding a new top-level package entry

1. Emit the entry from `font_to_tree` as a `(path, bytes)` pair; keep JSON deterministic and pretty-printed like the existing entries.
2. Parse it in `tree_to_font` with explicit absent-entry behavior — optional entries like `features.fea` are absent, never present-but-empty.
3. Bump the manifest schema version only when old readers can no longer parse the package: load rejects any mismatched `schemaVersion` outright, so a bump orphans packages for older builds.
4. Verify: `cargo test -p shift-source`, then `cargo test -p shift-workspace` because the workspace round-trips packages through save/open.

## Gotchas

- Glyph identity is validated strictly on load: every `glyphs/<glyphId>.json` must appear in `font.json`'s `glyphOrder` exactly once, every listed ID must have a file, and a glyph file whose internal `id` differs from its filename is a hard error, not a warning.
- Names in the package are label caches, not references. Kerning or component entries whose cached glyph name disagrees with the referenced glyph ID fail load — "fixing" a package by editing names without the IDs makes it unreadable.
- Non-finite numbers anywhere in metrics, coordinates, transforms, or locations are rejected in both directions. A font holding a NaN fails to save with a `NonFiniteNumber` error rather than producing a package that will not reopen.
- The manifest must be the first zip entry, named `manifest.json`, and stored uncompressed; every entry is written `Stored`. Repacking a `.shift` with a zip tool that compresses or reorders entries produces a package this crate refuses to open.
- `save_font` preserves the `packageId` of a valid package already at the target path; `save_font_as` always mints a new one. Picking the wrong method silently changes package identity, which the workspace uses to bind working stores to sources.
- Writes go through `<name>.shift.tmp` plus atomic rename with directory sync. A crashed save can leave a stale `.tmp` beside the package but never a truncated `.shift`.

## Verification

```bash
cargo fmt --all --check
cargo test -p shift-source
```

## Related

- `shift-font` -- live authoring model converted at the boundary.
- `shift-backends` -- extension-dispatch layer that can register `.shift` as a font backend.
- `shift-workspace` -- composes source package IO with the SQLite working store.

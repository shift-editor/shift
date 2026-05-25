# shift-source

`shift-source` is the spike crate for Shift's native source package format.

The crate is deliberately separate from `shift-ir` and `shift-backends`:

- `shift-ir` remains the canonical in-memory editing model.
- `shift-backends` remains the bridge to existing ecosystem formats such as UFO,
  designspace, Glyphs, and binary font files.
- `shift-source` explores a Shift-native package that can encode persistence
  choices we cannot safely express by reusing UFO/designspace conventions.

## Relationship To IR

`shift-source` is not a replacement for `shift-ir`. They answer different
questions:

```text
.shift package on disk
  -> load and validate
  -> ShiftPackage source graph
  -> shift_ir::Font editor projection
  -> renderer/app queries and commands
```

`shift-ir::Font` is the editing and rendering projection. It should stay fast,
ergonomic, and shaped around operations the editor performs constantly:
geometry edits, source/layer lookup, metrics, kerning/features, rendering, and
copy-on-write snapshots. It is not frozen at today's simpler component model:
source-package findings should promote into IR when they make the app API better.

`ShiftPackage` is the durable authoring graph. It owns source-format identity
and persistence behavior:

- stable glyph/source/axis IDs
- variable component source data
- glyph-local axes and glyph-local variation sources
- derived indexes
- fingerprints, conflicts, and prepared commits
- package-relative file ownership

Some source concepts can project cleanly into IR today. Others are intentionally
stored in `shift-source` until the editor needs first-class manipulation for
them. For example, IR glyphs, sources, and axes now carry stable IDs, and IR
components carry stable component IDs, durable base glyph IDs, sparse locations,
axis inheritance, and conditions because those concepts directly help rename
safety, source lookup, variable font operations, selection, undo, inspector
flows, and active/inactive component previews. `ShiftPackage` still owns
component variation sources until the editor needs first-class controls for
those recipes.

Promote concepts into IR when doing so makes editor code more direct:

- stable glyph/source/axis IDs for selection, rename, source lookup, and
  component references
- sparse component locations keyed by stable axis ID, plus reset/inherit
  behavior for variable-component inspection
- component conditions when rendering/selection depends on active components
- component variation sources when the editor exposes first-class controls for
  varying component location or transform

The app should query Rust services that own the source graph and its editor
projection. The renderer should not parse package JSON directly:

```text
WorkingSource
  package: ShiftPackage
  font: shift_ir::Font
  indexes: derived/query views
```

The first implementation of this boundary is `ShiftWorkingSource`. It owns a
validated `ShiftPackage`, keeps dependency and interpolation-compatibility
indexes warm, compiles axis-mapping resolvers for repeated location queries,
and exposes semantic operations that the app can call without parsing package
files or mutating IR directly.

Good renderer-facing queries:

```text
getGlyphDependents(glyphId)
getInterpolationCompatibility(glyphId)
getSourceLocations()
getComponentActivity(glyphId, layerId, location)
getComponentResolvedLocations(glyphId, layerId, location)
getGlyphVariationSourceLocations(glyphId)
getMappedLocation(location)
prepareCommit()
renameGlyph(glyphId, newName)
```

Build/export stays outside this crate. `shift-source` may store authoring
intent that a build needs, such as public axes, internal axes, mappings, glyph
variation sources, variable component recipes, export labels, and declared
output intent. `shift-backends` should decide how that intent lowers into
designspace, UFO, static or variable binaries, `avar`/`avar2`, `VARC`,
fallback decomposition, and artifact-specific diagnostics.

The intended flow is:

```text
ShiftPackage source graph
  -> ShiftWorkingSource semantic edits and queries
  -> shift_ir::Font editor/rendering projection
  -> shift-backends export/build lowering
  -> diagnostics back to the app
```

The renderer should call document/working-source commands for edits. The
backend should enter the flow for import, export, compile preview, and
compatibility preflight, not for ordinary source mutations.

TypeScript owns interaction and presentation state, not font truth. Zustand,
signals, and React components can hold the active glyph, selection, current
location, visible panels, pending UI affordances, and save/export progress. If a
change must persist to disk, it should go through a Rust document command. If TS
needs derived font knowledge, Rust should expose a query instead of making the
renderer rebuild source indexes or inspect package JSON.

Boundary rule:

```text
Rust document service owns source semantics and persistence.
shift_ir owns live editing/rendering data that benefits the editor loop.
TypeScript owns UI projection and interaction state.
```

The JSON files in `derived/` are persistence, reload, diagnostics, and recovery
artifacts. In memory, Rust can rebuild and serve the same query views directly
from `ShiftPackage`.

Current package shape:

```text
Family.shift/
  manifest.json
  font.json
  axes.json
  sources.json
  axis-mappings.json        # future
  layout.json               # future
  classes.json              # future
  kerning.json              # future
  glyphs/
    glyph_A.json
    glyph_Aacute.json
  derived/
    dependencies.json       # disposable cache
    interpolation-compatibility.json
```

Current writer behavior:

- `save_package()` rewrites canonical package modules directly. This is useful
  for fixtures and model exploration, but is not the production crash-safe
  writer.
- Optional canonical modules must not resurrect deleted state. For example,
  `axis-mappings.json` is removed when the package no longer has authored axis
  mappings.
- `diff_packages()` compares before/after package states and classifies the
  semantic source changes by stable ID.
- `plan_write_impact()` maps semantic package changes to relative canonical and
  derived paths. This is the bridge from source-format semantics to a future
  crash-safe staged writer.
- `fingerprint_package()` and `fingerprint_relative_paths()` provide stable
  file fingerprints for conflict checks, stale-cache checks, and save
  diagnostics.
- `compare_fingerprints()` reports created, deleted, modified, or malformed
  fingerprint comparisons before a writer touches live package files.
- `prepare_package_commit()` combines diffing, impact planning, current
  fingerprinting, conflict comparison, and staged operation descriptions.
- `ShiftWorkingSource::open_saved()` records the package and file fingerprints
  observed at open time. `prepare_commit()` then compares that saved baseline
  with the current package and current files, so the app can surface external
  file changes before the writer touches live package files.
- `ShiftWorkingSource::mark_saved()` refreshes the saved baseline after a
  successful writer commit.

Design rules for the spike:

- Glyphs and sources have stable source-format IDs. Names are editable labels.
- Packages must declare at least one source, and the manifest default source ID
  must reference a declared source at the completed global axis default
  location.
- Axes have stable IDs. Axis tags are export labels, not identity.
- Source locations are sparse over global axes. Missing coordinates resolve to
  axis defaults, and variable packages may not contain two sources at the same
  completed global location.
- Glyph files are addressed by stable glyph ID, not glyph name.
- Components reference base glyphs by glyph ID. A readable base glyph name is
  stored only as a label to make files inspectable.
- Components have stable component IDs. Public dependency and working-source
  queries name components by ID, not by array index.
- Components may carry sparse designspace locations keyed by stable axis ID,
  explicit axis inheritance behavior, and optional conditions.
- Component graphs must be acyclic. Cycles are rejected before a renderer or
  compiler can recurse through a component recipe forever.
- Component conditions use structured boolean trees. Empty `and`/`or` nodes,
  inverted axis ranges, and ranges that cannot intersect the axis domain are
  invalid source data.
- Glyphs may define local axes and local variation sources. This lets Shift
  model variable components and component recipes before current UFO/designspace
  can express them cleanly.
- Glyph-local axis IDs may not shadow global axis IDs. Glyph variation source
  locations complete missing global axes from their referenced source location
  and missing local axes from local defaults; two completed locations may not
  collide.
- JSON output is deterministic enough for early Git diffs: sorted glyphs,
  sorted maps, pretty JSON, trailing newline.
- The package owns its wire model. IR details may inform conversion, but this
  crate should not become "serde dumped IR".

This is not yet a production save path. The current writer creates package files
directly and is intended for format exploration and test fixtures.

## Use Cases Being Tested

The first tests encode the persistence problems that pushed us toward this
format exploration:

- **Rename without relinking:** a glyph's file path and inbound component
  references are based on stable glyph ID, not the editable glyph name.
- **Stable IDs are file-safe:** package IDs are validated as non-empty
  ASCII-stable identifiers before saving. A hand-authored glyph ID such as
  `../glyph_escape` is rejected before Shift creates `glyphs/` or writes any
  package file.
- **Glyph file ownership is explicit:** loading rejects `glyphs/<id>.json` when
  the JSON contains a different glyph `id`. A stable ID rename is a semantic edit
  with a planned file create/delete, not a silent side effect of moving JSON
  between files.
- **Load is a validation boundary:** `load_package()` validates the assembled
  package graph before returning it. The app should never receive a package with
  dangling component references, invalid source/layer links, malformed IDs, or
  impossible variable locations as editable state.
- **Delete without resurrection:** saving over an existing package removes stale
  glyph JSON files that no longer belong to the package.
- **Dependency previews are derived:** saving writes `derived/dependencies.json`
  so the app can answer delete/rename/dependency questions without reparsing the
  canonical graph. This file is disposable and regenerated from glyph files.
  Component dependencies are tracked by stable base glyph ID, including variable
  components that carry local-axis overrides, variation sources, or conditions.
- **Interpolation diagnostics are derived:** saving writes
  `derived/interpolation-compatibility.json` so the app can show variable-font
  compatibility badges without recomputing every glyph on each render.
- **Fail loudly on broken references:** missing component bases and missing
  source layers are validation errors, not silently dropped data.
- **Reject ambiguous component identity:** component IDs must be valid stable
  identifiers and unique within their glyph layer.
- **Require a valid default source:** packages cannot load with no sources, a
  missing manifest default source ID, a default source ID that no longer
  references a declared source, or a default source whose completed location is
  away from global axis defaults.
- **Reject impossible locations:** source locations, axis mapping samples, glyph
  variation sources, and variable component overrides must stay inside declared
  global or glyph-local axis ranges.
- **Reject invalid axis tags:** global axes must use valid four-character
  alphanumeric variable-font tags before interpolation or export can run. Invalid
  tags are not silently dropped from variation models.
- **Reject non-finite numbers:** metrics, source coordinates, glyph geometry,
  anchors, guidelines, component transforms, and condition ranges must be finite
  before save planning or export. Shift should fail with a typed validation error
  instead of letting `NaN`/`Infinity` reach JSON, interpolation, or binary build
  code.
- **Reject ambiguous variable sources:** in variable packages, two sources cannot
  occupy the same completed global location after sparse coordinates resolve to
  axis defaults.
- **Reject ambiguous glyph sources:** glyph-local axes cannot shadow global
  axes, and glyph variation sources cannot occupy the same completed location
  after sparse locations inherit source/global and local defaults.
- **Reject ambiguous axis mappings:** mapping declarations cannot duplicate
  input/output axes, every sample must provide all declared input and output
  axes, and no two samples can share the same input location.
- **Reject invalid encoded data:** unicode strings must parse as hexadecimal
  scalar values before conversion back into `shift-ir`.
- **Keep diffs readable:** glyphs are serialized in stable ID order, maps use
  deterministic key ordering, and JSON is pretty-printed with a trailing newline.
- **Variable component intent:** component locations may reference family axes
  and the base glyph's local axes. Unknown axes fail validation.
- **Conditional participation:** component conditions are structured data, not
  UI-only state. Conditions currently validate against global axes, reject empty
  boolean nodes, inverted ranges, or unreachable ranges outside the axis domain,
  and can be evaluated by `ShiftWorkingSource` at a partial design location
  using axis defaults for omitted coordinates.
- **Mutation planning:** a rename, glyph edit, axis edit, or delete can be
  turned into a narrow list of canonical files and derived indexes that need to
  be written, removed, or invalidated.
- **Before/after diffing:** source package states can be compared to recover the
  semantic changes that happened, even when the caller only has old and new
  package snapshots.
- **Conflict detection:** package-relative fingerprints capture existence, size,
  and stable content hashes for canonical and derived files before a staged
  writer replaces anything.
- **Conflict reporting:** fingerprint comparison names the exact relative path
  and whether it was externally created, deleted, modified, or missing from one
  side of the comparison.
- **Prepared commits:** the package can produce a serializable commit description
  with semantic changes, impacted paths, fingerprints, conflicts, and planned
  write/remove/invalidate operations.
- **Working-source operations:** a document-level service can rename a glyph by
  stable ID, preview delete dependents, refuse unsafe deletes, keep query
  indexes warm, and report the exact package diff caused by the semantic edit.
- **Component activity queries:** inspectors and preview renderers can ask which
  conditional components are active at the current design location without
  reimplementing condition-tree semantics in the renderer.
- **Component recipe summaries:** inspectors, sidebars, and export preflight can
  list static, conditional, variable, and conditional-variable components plus
  the axes involved without resolving every component at a concrete location.
  They also carry lowering hints and required capabilities, so backends can
  explain whether a component is a plain component, needs condition support,
  needs variable-component support, or will need fallback handling for a target.
- **Component lowering diagnostics:** export preflight can compare component
  recipes with a target capability profile before invoking a backend. This keeps
  source format semantics separate from backend policy while still letting the
  app show exact unsupported capabilities per glyph, layer, and component. A
  summary query also returns total/supported/unsupported component counts,
  affected glyph count, and counts per missing capability so export UI can make
  a fast proceed/fallback/fail decision without re-walking every diagnostic.
  Static-instance preflight can pass a concrete location; inactive conditional
  components are skipped and counted separately, while variable-font preflight
  can keep using the location-independent query that checks every recipe.
  Concrete preflight and preview locations are validated at the query boundary:
  unknown axes, non-finite values, or coordinates outside axis ranges return
  typed errors instead of producing misleading export diagnostics.
- **Component location resolution:** inspectors, preview renderers, and export
  preflight can ask how a variable component resolves sparse parent coordinates,
  explicit component overrides, reset-vs-inherit behavior, and base glyph local
  axis defaults into a concrete component location.
- **Component variation source resolution:** inspectors and export preflight can
  ask which authored component source applies at an exact parent location, or
  ask for an interpolated component location/transform at an in-between parent
  location, without parsing component JSON in the renderer. Conditional
  components that are inactive at the queried location report an explicit
  `inactive` resolution and skip variation-source interpolation.
- **Glyph variation source completion:** inspectors and export preflight can ask
  for each glyph variation source's completed location and see whether every
  value came from the referenced source location, a global axis default, a
  glyph-local default, or an explicit variation-source override.
- **Source location completion:** source panels and export preflight can ask for
  every source's completed global location and see whether each coordinate was
  explicit or inherited from an axis default.
- **Axis mapping resolution:** source-level user-axis to construction-axis
  mappings can be queried in Rust. One-dimensional mappings interpolate between
  samples; multi-axis mappings use the same `fontdrasil` variation model as
  glyph/component interpolation. This lets source panels preview avar2-style
  many-input-to-many-output mapping behavior without TypeScript rebuilding a
  separate interpolation stack. `ShiftWorkingSource` compiles those mapping
  resolvers when opened or refreshed, so scrubbing a variable location reuses
  the same model instead of rebuilding it per frame.

## Variable-First Direction

This crate is where we explore Shift Source as a graph-shaped authoring format,
not an interchange wrapper.

External references informing this direction:

- Fontra variable components in UFO:
  `https://github.com/fontra/variable-components-in-ufo`
- HarfBuzz Boring Expansion:
  `https://github.com/harfbuzz/boring-expansion-spec`
- HarfBuzz `VARC` proposal:
  `https://github.com/harfbuzz/boring-expansion-spec/blob/main/VARC.md`
- HarfBuzz `avar` v2 proposal:
  `https://github.com/harfbuzz/boring-expansion-spec/blob/main/avar2.md`

Lessons being folded into the package model:

- Variable components need a base glyph, decomposed transform, sparse location,
  explicit inheritance behavior, and sometimes a condition.
- Component location and transform can themselves vary across the parent design
  location. Shift models this as component variation sources and resolves them
  through `shift-ir::variation::NormalizedF64VariationModel`, the same
  `fontdrasil`-backed model used by glyph interpolation. This lets the app build
  one resolved component model for repeated preview/export queries before
  committing to a specific binary lowering such as `VARC`.
- The component's own transform and sparse location are the default state.
  Component variation sources may not target the default parent location, and
  two variation sources may not target the same completed parent location. This
  prevents ambiguous authored data and avoids silent overwrite when building the
  variation point map.
- Glyph-local axes are a first-class authoring concept. A component should be
  able to select a base glyph at both family-axis and base-local-axis locations.
- User-facing axes and construction axes are distinct. The source package should
  preserve that distinction so exports can choose which axes become `fvar`,
  `avar`/`avar2`, `VARC`, designspace axes, or static build artifacts.
- Axis mappings are authored in `axis-mappings.json`: user-facing coordinates
  can drive internal construction-axis coordinates without making those axes the
  same thing. Mapping samples are explicit, not sparse: each sample must provide
  all declared input and output axes, and sample input locations must be unique.
  One-dimensional mappings interpolate by ordered sample position. Multi-axis
  mappings build a normalized variation model over the declared input axes and
  interpolate declared output axes at the queried location.
  A mapping output axis may not be used as another mapping's input axis until
  Shift has an explicit mapping graph; current mappings are independent rules,
  not list-ordered programs.
- Sparse axis participation is important for performance and filesize. A
  component or glyph source should mention only the axes it actually controls.

Current component sketch:

```json
{
  "id": "component_A_stem",
  "baseGlyphId": "glyph_stem",
  "baseGlyphName": "stem",
  "axisInheritance": "inheritParent",
  "location": {
    "axis_wght": 700,
    "axis_stemWidth": 42
  },
  "variationSources": [
    {
      "id": "componentSource_black",
      "name": "Black component",
      "parentLocation": {
        "axis_wght": 900
      },
      "location": {
        "axis_stemWidth": 72
      },
      "transform": {
        "translateX": 12,
        "translateY": 0,
        "rotation": 0,
        "scaleX": 1.2,
        "scaleY": 1.2,
        "skewX": 0,
        "skewY": 0,
        "tCenterX": 0,
        "tCenterY": 0
      }
    }
  ],
  "condition": {
    "kind": "axisRange",
    "axisId": "axis_wght",
    "min": 600
  },
  "transform": {
    "translateX": 0,
    "translateY": 0,
    "rotation": 0,
    "scaleX": 1,
    "scaleY": 1,
    "skewX": 0,
    "skewY": 0,
    "tCenterX": 0,
    "tCenterY": 0
  }
}
```

Current glyph-local designspace sketch:

Glyph variation source locations are sparse. Missing global axis values come
from the referenced source's location, and missing local axis values come from
the glyph-local axis defaults. The completed location must be unique within the
glyph.

```json
{
  "id": "glyph_stem",
  "name": "stem",
  "localAxes": [
    {
      "id": "axis_stemWidth",
      "name": "Stem Width",
      "minimum": 20,
      "default": 40,
      "maximum": 80
    }
  ],
  "variationSources": [
    {
      "id": "glyphSource_stem_default",
      "name": "Default",
      "location": {
        "axis_wght": 400,
        "axis_stemWidth": 40
      },
      "layerId": "source_Regular"
    }
  ]
}
```

Current axis mapping sketch:

Axis mappings are intended to be inspectable authoring rules, not hidden
compiler behavior. One-dimensional mappings may interpolate between unique
sample inputs. Multi-axis mappings use normalized variation interpolation over
their input axes, so an in-between public location can resolve to in-between
internal construction coordinates. Mappings cannot implicitly chain through list
order.

```json
[
  {
    "id": "mapping_weight_to_stem",
    "name": "Weight drives stem",
    "inputAxes": ["axis_wght"],
    "outputAxes": ["axis_stem"],
    "samples": [
      {
        "inputLocation": { "axis_wght": 900 },
        "outputLocation": { "axis_stem": 1 }
      }
    ]
  }
]
```

This is the source-side concept behind `avar2`: Shift keeps an explicit,
inspectable mapping from public controls to internal construction axes. Export
can later choose whether this becomes `avar2`, designspace rules, static source
materialization, or another target-specific representation.

## App Behavior Enabled

The format should make these app behaviors straightforward:

- Rename/delete previews from a dependency graph keyed by stable IDs.
- Delete dialogs that can offer remove, decompose, or relink based on exact
  dependents.
- Conservative delete commands that fail before mutation when component
  dependents still exist.
- Sidebars and badges backed by derived indexes instead of repeated full scans.
- Variable component inspectors that show inherited values, explicit overrides,
  local axes, and active/inactive conditions.
- Component recipe lists that can quickly identify static, conditional,
  variable, and conditional-variable components before asking for current
  location state, including which export capabilities each recipe requires.
- Target capability diagnostics that tell export UI whether the chosen backend
  can preserve conditions, variable component locations, variable transforms,
  and reset-vs-inherit axis semantics before any compiler runs. The app can
  render a compact summary first and expand into per-component diagnostics only
  when the user needs details.
- Static-instance export preflight that uses the same condition evaluation as
  preview, so unsupported inactive recipes do not block a concrete instance but
  are still counted as skipped for explainability.
- Current-location previews that use the same condition evaluation rules as
  save/export preflight, with the same query-location validation as export
  preflight and axis-mapping previews.
- Component recipe UI that can label each resolved axis value as coming from the
  parent location, font default, base local default, or component override.
- Component recipe UI that can show exact authored component variation sources:
  at a given parent location, which source changed the component location and
  transform.
- Component variation sources reject default-location redefinitions and duplicate
  parent locations, so the app never shows or saves an ambiguous recipe where
  one authored source silently overwrites another interpolation point.
- Component recipe UI that can preview interpolated component state at
  in-between locations using the same variation math as glyph interpolation.
- Glyph source inspectors that can show completed variation-source coordinates
  with provenance, instead of making the renderer infer defaults from sparse
  package data.
- Axis inspectors that show how public controls drive internal construction
  axes, including when a location falls outside authored mapping samples.
- Export explanations that say which source graph concepts became designspace,
  UFO, `avar`, `VARC`, or static fallback data.
- Interpolation compatibility diagnostics that identify contour and component
  mismatches before export.
- Fast one-glyph mutation where the canonical write is one glyph file and the
  affected derived indexes are regenerated or invalidated.
- Variable-axis UI can distinguish public sliders from internal construction
  axes, while still showing how one drives the other.
- Save diagnostics can show exactly which source modules a command intended to
  touch before the staged writer commits them.

## Mutation Impact Planning

`diff_packages()` and `plan_write_impact()` are the first concrete APIs that tie
source-graph semantics to safe load/save work. The diff API turns old/new package
states into `ShiftPackageChange` values; the impact API turns those changes into
relative package paths.

The path output is deliberately relative rather than absolute so the same plan
can drive:

- staged package writes
- app diagnostics
- dirty-resource badges
- targeted derived index invalidation
- future autosave or command batching

Examples:

```text
RenameGlyph(glyph_A)
  canonical: glyphs/glyph_A.json
  derived:   derived/dependencies.json

UpdateGlyph(glyph_A)
  canonical: glyphs/glyph_A.json
  derived:   derived/dependencies.json
             derived/interpolation-compatibility.json

UpdateGlyph(glyph_stem) from glyph-local variation source edit
  canonical: glyphs/glyph_stem.json
  derived:   derived/dependencies.json
             derived/interpolation-compatibility.json

UpdateGlyph(glyph_A) from component variation source edit
  canonical: glyphs/glyph_A.json
  derived:   derived/dependencies.json
             derived/interpolation-compatibility.json

DeleteGlyph(glyph_A)
  remove:    glyphs/glyph_A.json
  derived:   derived/dependencies.json
             derived/interpolation-compatibility.json

UpdateAxisMappings
  canonical: axis-mappings.json
  derived:   derived/interpolation-compatibility.json
```

The important behavior is that a glyph rename does not rewrite dependents.
Components target `baseGlyphId`, so the rename changes the renamed glyph file
and the dependency label cache. A component edit is different: it changes the
owner glyph file and invalidates the dependency index because the graph may have
changed.

The diff API preserves that distinction:

```text
old glyph_A.name = "A"
new glyph_A.name = "A.alt"
  -> RenameGlyph(glyph_A)

old glyph_Aacute.width = 600
new glyph_Aacute.width = 620
  -> UpdateGlyph(glyph_Aacute)
```

This matters for app behavior. A rename can show a cheap dependency-label
refresh; a component or outline edit can mark interpolation compatibility and
dependency views stale. The save path does not need to guess from raw files.

The production writer still needs to turn this impact plan into staged writes,
backups, validation, and recovery markers. The package model now gives that
writer the narrow write set and a prepared commit object.

## Prepared Commits

`prepare_package_commit()` creates the handoff object for a recoverable writer:

```text
ShiftPreparedCommit
  diff
  impactedPaths
  expectedFingerprint
  currentFingerprint
  conflicts
  operations
```

The operations are intentionally explicit:

```text
WriteFile(path, canonical, size, hash)
RemoveFile(path, canonical)
WriteFile(path, derived, size, hash)
InvalidateDerived(path)
```

Examples:

```text
RenameGlyph(glyph_A)
  -> WriteFile(glyphs/glyph_A.json, canonical)
  -> WriteFile(derived/dependencies.json, derived)

UpdateAxisMappings to empty list
  -> RemoveFile(axis-mappings.json, canonical)
  -> WriteFile(derived/interpolation-compatibility.json, derived)
```

The prepared commit can be written into a recovery marker before live files are
replaced. If the process crashes, recovery has enough information to know:

- which files were supposed to be touched
- which files were expected at commit start
- which current files had conflicts
- which staged payloads existed by size/hash
- which derived files can be discarded and rebuilt

This is still not the final writer. It is the durable shape the writer should
consume.

`stage_prepared_commit()` is the next handoff step. It refuses prepared commits
with unresolved conflicts, writes `commit.json` into `.shift-txn/<id>/`, writes
all canonical and derived payloads under `.shift-txn/<id>/payloads/`, and checks
every payload against the size/hash recorded in the prepared operation. It does
not replace live files. Staging gives recovery a concrete marker and verified
bytes before any live mutation starts.

Only one distinct staged transaction may be active at a time. Re-staging the
same prepared commit is allowed so missing payloads can be recreated
idempotently, but staging a different transaction while another transaction
directory exists fails before writing new payload bytes. This keeps startup
recovery deterministic: the app never has to infer ordering across multiple
uncommitted source transactions.

`inspect_staged_commits()` is the startup/recovery counterpart. It scans
`.shift-txn/`, reads each `commit.json`, verifies expected payloads by size/hash,
and reports incomplete transactions as structured issues such as missing
markers, invalid markers, missing payloads, or payload mismatches. Recovery can
also classify live files as `pending` when they still match the pre-commit
fingerprint, `applied` when they already match staged payloads/removals, or
`diverged` when neither is true. A transaction whose paths are a mix of pending
and applied is `partiallyApplied`, which is resumable rather than a conflict.
Each recovery report carries per-path state, so a recovery dialog can say which
exact files are still old, already promoted, or externally modified.

`plan_staged_commit_recovery()` is the app-facing policy layer over inspection.
It returns one action per transaction:

- `resume` for pending or partially applied transactions
- `cleanup` for transactions whose live files already match the staged result
- `blockedByLiveConflict` when any touched file diverged from both expected and
  staged bytes
- `cannotRecover` when the transaction marker or payloads are missing or invalid

The app can therefore recover on open without inferring policy from raw file
fingerprints.

`load_package()` enforces that recovery boundary before trusting package files.
It refuses to load when any staged transaction needs `resume`, is
`blockedByLiveConflict`, or `cannotRecover`, because the package may be
partially promoted or externally modified. It allows cleanup-only transactions:
those live files already match the staged result, so the loaded package is
coherent even if `.shift-txn/<id>/` has not been removed yet.

`cleanup_applied_staged_commit()` removes only transactions whose live files
already match the staged result, which covers the crash window after promotion
but before transaction cleanup.

`apply_staged_commit()` is the current live-promotion primitive. It reinspects
the staged transaction, refuses true live divergence, backs up canonical files
under `.shift-backups/<id>/originals/`, promotes staged payloads through a
same-directory hidden temp file and rename, removes canonical files marked for
deletion, removes invalidated derived files, and clears the staged transaction
after success. Payload promotion syncs the temp file before rename and attempts
to sync the parent directory after rename where the filesystem supports it. It
is retryable after a crash midway through promotion: paths already matching the
staged result are treated as applied, pending paths are finished, and genuinely
divergent paths still stop the commit before more live files are touched.

`ShiftWorkingSource` is the app-facing entry point for this save preflight. The
intended flow is:

```text
startup
  -> planStagedCommitRecovery(root)
  -> resume, cleanup, or prompt before loadPackage(root)
open package
  -> ShiftWorkingSource::open_saved(root, package)
edit through working-source semantic operations
  -> prepareCommit(root)
  -> show conflicts or stagePreparedCommit(root, package, prepared)
  -> applyStagedCommit(root, transactionId)
writer succeeds
  -> markSaved(root)
```

## File Fingerprints

`fingerprint_package()` records the current package file state:

```json
{
  "files": {
    "manifest.json": {
      "exists": true,
      "size": 92,
      "hash": "..."
    },
    "glyphs/glyph_A.json": {
      "exists": true,
      "size": 241,
      "hash": "..."
    },
    "glyphs/glyph_missing.json": {
      "exists": false
    }
  }
}
```

The hash is a deterministic 64-bit FNV-1a content hash. It is not a security
primitive; it is a cheap, stable change detector for local source-file conflict
checks and diagnostics.

This supports the staged writer sequence:

```text
1. diff before/after packages
2. plan write impact
3. collect impact.package_relative_paths()
4. fingerprint impacted package-relative files
5. stage replacement files
6. re-fingerprint impacted live files
7. compare fingerprints
8. abort if fingerprints changed externally
9. replace touched files and write recovery marker
```

Conflict examples:

```text
glyphs/glyph_A.json
  -> modified

glyphs/glyph_B.json
  -> deleted

glyphs/glyph_C.json
  -> created
```

`ShiftWriteImpact::package_relative_paths()` is the handoff between semantic
diffing and fingerprinting:

```text
canonical: glyphs/glyph_A.json
remove:    glyphs/glyph_B.json
derived:   derived/dependencies.json
  -> [derived/dependencies.json, glyphs/glyph_A.json, glyphs/glyph_B.json]
```

Missing files are represented explicitly. That matters for deletes and creates:
if `glyphs/glyph_A.json` was missing when the edit began and exists before
commit, the writer has an external conflict. If it existed when the edit began
and is missing before commit, the writer also has an external conflict.

`fingerprint_relative_paths()` rejects absolute paths and `..` traversal. The
save layer should operate in package-relative paths only, so diagnostics and
recovery markers cannot accidentally target files outside the package.

## Derived Indexes

Derived indexes are cache-like files in the spike. They are not canonical; if
they are absent or stale, Shift can rebuild them from canonical package files.

### Dependencies

`derived/dependencies.json` is generated from `glyphs/*.json`.

The index records structural component ownership only: which glyph uses which
base glyph through which stable component ID on which layer. It deliberately
does not copy the component's transform, conditions, sparse location, or
variation sources. Those details remain canonical in the owner glyph file,
while the index is enough for delete/rename preflight and dependency UI to
avoid scanning every glyph.

Current shape:

```json
{
  "version": 1,
  "glyphs": {
    "glyph_A": {
      "glyphId": "glyph_A",
      "glyphName": "A",
      "componentDependencies": [],
      "componentDependents": [
        {
          "glyphId": "glyph_Aacute",
          "glyphName": "Aacute",
          "layerId": "source_Regular",
          "componentId": "component_Aacute_base"
        }
      ]
    }
  }
}
```

This directly supports:

- delete dialogs that show exact component users
- rename previews keyed by stable glyph ID
- dependency badges in the glyph grid/sidebar
- narrow invalidation after component edits
- future `shift query dependents --glyph glyph_A` style tooling

### Interpolation Compatibility

`derived/interpolation-compatibility.json` is generated from glyph layer
topology. The current index checks:

- contour count
- contour point types
- open/closed contour state
- component count
- component stable IDs
- component base glyph IDs paired with each stable component ID

Current shape:

```json
{
  "version": 1,
  "glyphs": {
    "glyph_A": {
      "glyphId": "glyph_A",
      "glyphName": "A",
      "compatible": false,
      "layerSignatures": {
        "source_Regular": {
          "contourPointTypes": [["onCurve", "onCurve"]],
          "contourClosed": [true],
          "components": []
        },
        "source_Bold": {
          "contourPointTypes": [["onCurve", "onCurve", "offCurve"]],
          "contourClosed": [true],
          "components": []
        }
      },
      "issues": [
        {
          "kind": "contourTopologyMismatch",
          "referenceLayerId": "source_Bold",
          "layerId": "source_Regular",
          "expected": "on-on-off:closed",
          "actual": "on-on:closed"
        }
      ]
    }
  }
}
```

This directly supports:

- grid/sidebar badges for incompatible variable glyphs
- per-glyph inspector warnings that identify the exact mismatching layer
- export preflight diagnostics before generating variable fonts
- targeted recomputation when `UpdateGlyph`, `DeleteGlyph`, axes, sources, or
  axis mappings change

This index intentionally stores signatures rather than rendered geometry. It is
a product diagnostic and invalidation target, not canonical outline data.

Rule:

```text
canonical glyph files win
derived indexes accelerate app behavior
derived indexes must be safe to delete
```

## Current Limits

- New IR glyphs derive readable IDs from their creation names, and loading an
  existing `.shift` package preserves source glyph IDs across renames. External
  name-keyed formats still need import policy for generated IDs and collision
  handling.
- `save_package()` remains a direct whole-package fixture helper, but the
  production direction is the staged incremental writer: prepare a narrow
  semantic commit, write verified payloads under `.shift-txn`, promote payloads
  through temp-file rename, and recover or resume from the transaction marker.
- Component references are ID-based in the package and IR. The readable
  `baseGlyphName` is a label/cache for UI and compatibility, not the canonical
  target.
- Variable component locations, axis inheritance, and conditions now project
  into `shift-ir`. Component locations stay ID-keyed because they can reference
  glyph-local axes as well as global axes. Glyph-local axis definitions and
  component/glyph variation sources still need deeper IR modeling before they
  can drive ordinary editor behavior.
- Export/build diagnostics are not wired to `shift-backends` yet, but the source
  model now rejects out-of-range authored coordinates before backend lowering.

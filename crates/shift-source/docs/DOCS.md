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
them. For example, IR glyphs, sources, and axes now carry stable IDs, IR glyphs
carry glyph-local axes, and IR components carry stable component IDs, durable
base glyph IDs, sparse locations, axis inheritance, and conditions because
those concepts directly help rename safety, source lookup, variable font
operations, selection, undo, inspector flows, and active/inactive component
previews. `ShiftPackage` still owns component and glyph variation source
recipes until the editor needs first-class controls for those recipes.

Promote concepts into IR when doing so makes editor code more direct:

- stable glyph/source/axis IDs for selection, rename, source lookup, and
  component references
- glyph-local axes when component locations or inspectors need to reason about
  base-glyph construction axes
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
indexes warm, caches source-layer coverage and variable-font readiness, compiles
axis-mapping and component-variation resolvers for repeated location queries,
and exposes semantic operations that the app can call without parsing package
files or mutating IR directly. Semantic mutations rebuild these derived views
before replacing live state, so renderer panels and export preflights read a
consistent projection without repeating source/package scans on every query.
App-facing report and preview queries include the working-source `revision` when
their answer can be used asynchronously by renderer panels or confirmation
dialogs. The renderer should ignore a returned coverage/readiness/component
preflight/export-preflight/preview payload if its revision is older than the
current document revision. Destructive dialogs should also re-check that preview
revision before committing the command, so a rename/delete/source-layer action
cannot accidentally apply a stale confirmation after another edit.

Good renderer-facing queries:

```text
getGlyphDependenciesReport(glyphId)
getGlyphInterpolationCompatibilityReport(glyphId)
getSourceLocations()
getSourceMappedLocationsReport()
getSourceLayerCoverageReport()
getSourceLayerCoverageSummary()
getSourceLayerCoverage()
getSourceLayerCoverageWorklist()
getVariableFontReadinessReport()
getVariableFontExportPreflight(target) -> readiness + primaryAction + source/component blockers
getAxisMappingsReport()
getComponentActivity(glyphId, layerId, location)
getComponentResolvedLocations(glyphId, layerId, location)
getComponentRecipe(glyphId, layerId, componentId)
getComponentVariationSourceLocations(glyphId, layerId, componentId)
getGlyphVariationSourceLocations(glyphId)
getMappedLocation(location)
prepareCommit()
previewRenameGlyph(glyphId, newName)
renameGlyph(glyphId, newName)
previewDeleteGlyph(glyphId)
deleteGlyph(glyphId)
previewDeleteGlyphRemoveComponentReferences(glyphId)
deleteGlyphAndRemoveComponentReferences(glyphId)
getGlyphRelinkReplacementCandidatesReport(glyphId)
previewDeleteGlyphRelinkComponentReferences(glyphId, replacementGlyphId)
deleteGlyphAndRelinkComponentReferences(glyphId, replacementGlyphId)
previewDeleteSource(sourceId)
createAxisMapping(create)
updateAxisMapping(mappingId, update)
deleteAxisMapping(mappingId)
createSource(create)
updateSource(sourceId, update)
deleteSource(sourceId)
createGlyph(create)
createGlyphSourceLayer(glyphId, sourceId, create)
previewDeleteGlyphSourceLayer(glyphId, sourceId)
deleteGlyphSourceLayer(glyphId, sourceId)
createGlyphVariationSource(glyphId, create)
updateGlyphVariationSource(glyphId, sourceId, update)
deleteGlyphVariationSource(glyphId, sourceId)
createComponentVariationSource(glyphId, layerId, componentId, create)
updateComponentVariationSource(glyphId, layerId, componentId, sourceId, update)
deleteComponentVariationSource(glyphId, layerId, componentId, sourceId)
```

Build/export stays outside this crate. `shift-source` may store authoring
intent that a build needs, such as public axes, internal axes, mappings, glyph
variation sources, variable component recipes, export labels, and declared
output intent. The backend/export path, including `fontc` where it is the
compiler, should decide how that intent lowers into designspace, UFO, static or
variable binaries, `avar`/`avar2`, `VARC`, fallback decomposition, and
artifact-specific diagnostics.

`fontc` should be treated as the compiler for generated inputs, not as the
policy engine for Shift authoring semantics. Before a backend hands generated
UFO/designspace data to `fontc`, it should use source queries to decide whether
components can be preserved as plain static references, resolved at a concrete
instance, decomposed into outlines, materialized as generated helper glyphs, or
rejected with a typed diagnostic. The source package provides the semantic
evidence; the export backend owns the artifact-specific fallback choice.
For variable export UI, `variableFontExportPreflight(target)` combines source
coverage/interpolation readiness with component capability preflight into one
app-facing readiness state: single-source, ready, source-blocked,
component-blocked, or blocked by both. Axis-mapping diagnostics for declared
source locations are source-readiness blockers too, because exporting with a
failed mapping would silently use fallback construction-axis defaults. It also
returns a `primaryAction`: `exportVariableFont`, `addSource`,
`resolveSourceReadiness`, `resolveComponentLowering`, or
`resolveSourceReadinessAndComponentLowering`. The renderer can drive menu items,
export panels, and warnings from that action and a compact top-level summary
while still showing the source coverage summary, source coverage worklist,
source mapped-location diagnostics, and exact component diagnostics as detail.

The intended flow is:

```text
ShiftPackage source graph
  -> ShiftWorkingSource semantic edits and queries
  -> shift_ir::Font editor/rendering projection
  -> shift-backends/fontc export and build
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

Performance rule:

```text
Source files are opened, validated, and saved by Rust.
Rust keeps the live ShiftWorkingSource in memory.
N-API exposes coarse commands and explicit bulk queries.
Mutations return revision-stamped deltas, not full source snapshots.
TypeScript stores lightweight UI projections keyed by revision.
```

The renderer should not treat `.shift` files as its data interface. On open,
Rust loads the package, validates it, builds the editor projection, warms
derived indexes, and records the saved fingerprint. During editing, TypeScript
talks to that in-memory working source through semantic commands. Crossing the
N-API boundary per glyph, per component, or per source row is the wrong shape;
the app should prefer one command/query that returns the rows, summaries, and
revision needed by a screen.

Mutation responses should be patch-shaped. A font-info edit, rename, delete,
source-layer edit, or variation-source edit returns the semantic result plus
compact updates for the affected projections: dependency rows, compatibility
rows, coverage summary/worklist evidence, source-location rows, or save impact
depending on what changed. The response must include a working-source
`revision`; renderer stores should drop responses older than the current
document revision.

Large payloads are still allowed, but only as explicit bulk queries for screens
that need them:

```text
glyphGridSnapshot()
sourceLayerCoverageReport()
interpolationCompatibilityIndexReport()
variableFontExportPreflight(target)
componentRecipesReport(glyphId, layerId)
```

This keeps app state responsive without moving source truth into TypeScript.
Zustand/signals can cache badge maps, selected rows, visible panels, and export
summaries, but those caches are projections. If profiling shows derived-view
rebuilds are too expensive, the fix is to update Rust indexes incrementally from
`ShiftPackageChange`, not to make the renderer scan package JSON or issue many
small N-API calls.

Scrubbing and hot edit sessions follow the same rule. Moving a variation slider
should update a TypeScript cell for the current location and render from the
already-loaded editor projection. It should not call Rust once per glyph on
every frame. Rust owns the source graph, axis maps, local axes, component
recipes, and compatibility evidence; the editor runtime owns the current
location, hover state, selection state, viewport, active tool, and draft contour
overlay while the user is dragging.

The cache keys should make this explicit:

```text
documentRevision
glyphId
layerOrSourceId
normalizedLocation
editSessionVersion
```

A committed source edit bumps the working-source revision and returns compact
invalidations for the cache namespaces it touched. A glyph rename invalidates
labels and dependency rows. A contour commit invalidates geometry for that glyph
and layer/source. Axis-map and component-recipe edits invalidate normalized
location or component-resolution caches. During an active contour drag, the
renderer can draw a local overlay at pointer speed and send one semantic command
when the gesture or transaction commits.

This means `shift-source` helps the app by making the slow questions explicit:
load and validate this package, resolve this location, tell me which glyphs are
compatible, tell me which sources are complete, and prepare this save. It does
not replace the editor loop. The editor loop should keep its own signals, IR
projection, render caches, and transient interaction state, all keyed by the
Rust revision so stale responses can be ignored.

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
- `preview_package_load()` is the non-mutating app query for startup/open
  readiness. It returns `ready`, `readyWithCleanup`, `recoveryRequired`, or
  `blockedByRecovery` with staged-transaction summaries and per-transaction
  plans, plus a `primaryAction` of `load`, `cleanupThenLoad`,
  `recoverThenLoad`, or `block`. The status remains the durable machine state;
  the primary action is the app-facing button/flow decision. Open UI can choose
  load, cleanup, resume, or warning states without interpreting `.shift-txn`
  internals.
- `ShiftWorkingSource::preview_save()` is the non-mutating app query for save
  readiness. It returns `unchanged`, `ready`, or `blockedByExternalChanges`
  along with a compact summary, a `primaryAction` of `nothingToSave`, `save`,
  `resolveExternalChanges`, or `resolveStagedCommit`, and the prepared commit
  evidence. Save buttons, conflict banners, and dirty-state projections should
  follow this app-level action instead of inferring status from raw
  diff/conflict lists. The summary separates canonical source writes,
  canonical source removals, and derived-cache impact, so UI can distinguish
  user-authored data changes from disposable cache regeneration without parsing
  the full prepared commit. Conflict summaries are also grouped by fingerprint
  conflict kind and by path class (`canonicalSource` vs `derivedCache`), so
  save banners can distinguish "source changed on disk" from "cache changed on
  disk" without walking every conflict row.
  Even an unchanged working source compares the full saved package fingerprint
  against disk before reporting `unchanged`, so external edits cannot be
  accidentally accepted as the new clean baseline.
  It also reports `blockedByStagedCommit` with staged recovery plans when
  `.shift-txn` contains active transaction metadata, so the app resolves or
  cleans recovery state before allowing a new save. Staged recovery summaries
  are grouped by action and by observed live state, so app chrome can
  distinguish resumable saves, cleanup-only transactions, live-conflict
  blockers, unrecoverable staged metadata, pending files, partially applied
  files, applied files, and diverged files without scanning every recovery plan.
- `ShiftWorkingSource::save()` is the app-facing happy path for a document save:
  it prepares, stages, applies, and marks the working source saved only after
  the staged commit has succeeded.
- `ShiftWorkingSource::mark_saved()` refreshes the saved baseline after a
  successful writer commit. It refuses active `.shift-txn` metadata, reloads
  the package from disk, checks that the loaded package matches the in-memory
  package semantically, then fingerprints the saved files before updating the
  in-memory saved baseline. A failed refresh does not corrupt dirty-state
  bookkeeping.

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
- Components reference base glyphs by glyph ID. A readable base glyph name is a
  canonical label cache: it is not the target identity, but it must match the
  current base glyph name so package files remain inspectable after rename.
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
  references are based on stable glyph ID, not the editable glyph name. Rename
  commands refresh dependent component label caches without changing component
  targets.
- **Rename preview:** the app can ask for a prospective rename's old/new name,
  component dependents, and narrow write impact before mutating the working
  source. Duplicate names and stale selections use the same semantic errors as
  the command path. The preview carries the current working-source revision so
  the app can invalidate a stale confirmation if another edit lands before the
  user commits the rename.
- **Glyph creation:** quick-add and catalog flows can create a glyph through a
  semantic command. App-authored creates allocate collision-safe names and
  stable IDs, can attach an initial default-source layer, validate the candidate
  package before swapping live state, and report a narrow `CreateGlyph` write
  impact.
- **Font info editing:** font metadata and global metrics are edited through a
  semantic `update_font_info` command. The command validates the candidate
  package before swapping live state, rejects invalid metrics without partial
  mutation, returns a revision-stamped report, and reports the narrow
  `UpdateFontInfo` write impact so saves touch only `font.json`.
- **Glyph labels are app-safe:** glyph names are editable labels, but they must
  not be blank after trimming. Semantic create/rename commands normalize UI
  whitespace before validation so a direct grid edit cannot save source data
  that later panics during IR projection.
- **Glyph Unicode values are scalar values:** package validation rejects
  malformed hex, surrogate codepoints, and values above `U+10FFFF` before they
  can reach IR projection or export. Semantic glyph creation stores them in
  canonical uppercase hex form, so `41`, `0041`, and `000041` all become
  `0041`.
- **Unicode ownership is unambiguous:** a codepoint may belong to only one glyph
  in the source graph, so literal-character lookup, coverage accounting, cmap
  export, and `glyphByUnicode`-style app queries do not depend on iteration
  order.
- **Source labels are app-safe:** source names are editable labels for masters
  and layers, but they must be nonblank and unique. Semantic source creation can
  fall back to `New Source`/`New Source.1` for plus-button flows, while blank
  source updates fail without mutating the working graph.
- **Axis and mapping labels are app-safe:** axis names and axis-mapping names
  must be nonblank and unique, keeping sliders, mapping panels, and diagnostics
  readable. Semantic mapping creation can fall back to `New Mapping` and
  disambiguates duplicate names, while blank mapping updates fail without
  mutating the working graph.
- **Variable authoring labels are app-safe:** glyph-local axes, glyph variation
  sources, and component variation sources also require nonblank, unique labels
  inside their owning glyph or component. Semantic variation-source creation
  falls back to readable names and disambiguates duplicates, while blank updates
  fail without mutating the working graph.
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
  The dependency index report wraps the package-level derived graph with the
  working-source revision and aggregate edge/glyph counts, so grid and sidebar
  badges can update without TypeScript scanning every dependency row. Glyph
  create, rename, delete, remove-component delete, and relink-delete reports
  return this refreshed dependency index as well, so the command response that
  changed the component graph or labels can refresh dependency badges and delete
  affordances directly.
  The glyph dependency report wraps one derived dependency record with the
  working-source revision and compact dependency/dependent counts, so sidebars
  and delete dialogs can render badges and discard stale async results without
  scanning the package-level dependency index in TypeScript.
- **Interpolation diagnostics are derived:** saving writes
  `derived/interpolation-compatibility.json` so the app can show variable-font
  compatibility badges without recomputing every glyph on each render. The
  index carries package-wide, per-glyph, and per-issue-kind counts so source
  panels, export preflights, and warning badges can summarize health without
  scanning every detailed issue row. The compatibility index report wraps that
  derived index with the working-source revision and compact summary, so
  package-wide compatibility badges can update from counts and reject stale
  async results without walking the full glyph map.
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
- **Working-source operations:** a document-level service can edit font metadata
  and metrics, rename a glyph by stable ID, preview delete dependents, refuse
  unsafe deletes, create/update/delete family sources by stable IDs, edit
  component and glyph variation sources by stable IDs, create glyph and
  component variation sources with collision-safe generated IDs, delete
  variation sources by stable IDs, remove component references before deleting a
  base glyph through an explicit command, keep query indexes warm, and report
  the exact package diff caused by the semantic edit. Source edits validate the
  default-source invariant, source-location uniqueness, and all glyph layer
  references before replacing the live working graph, so adding a master is
  cheap while unsafe deletes or accidental default-source moves are rejected
  without partial mutation. Font-info edits validate global metrics before
  replacing the live working graph. Variation source edits validate the whole
  candidate package before replacing the live working graph. Semantic edits
  rebuild dependency, compatibility, axis-mapping, and component variation query
  views from the candidate before swapping state, so invalid edits or future
  index errors do not leave partially mutated source state behind.
- **Source delete previews:** source panels can ask why a source cannot be
  deleted before attempting mutation. The preview reports whether the source is
  the manifest default, which glyph layers use it, which glyph-local variation
  sources reference it as their backing layer, and whether deletion is possible
  without a future cascade operation. This gives the app enough data to show a
  precise warning instead of surfacing a late validation error.
- **Component activity queries:** inspectors and preview renderers can ask which
  conditional components are active at the current design location without
  reimplementing condition-tree semantics in the renderer. Conditional
  components include a structured evaluation tree with resolved axis values and
  per-node active states, so the app can explain why a component is hidden.
- **Component recipe summaries:** inspectors, sidebars, and export preflight can
  list static, conditional, variable, and conditional-variable components plus
  the axes involved without resolving every component at a concrete location.
  They also carry lowering hints and required capabilities, so backends can
  explain whether a component is a plain component, needs condition support,
  needs variable-component support, or will need fallback handling for a target.
  Transform variation is reported by exact decomposed fields, not only as one
  boolean, so export UI and backend code can distinguish `translateX`-only
  motion from scale, rotation, skew, or transformation-center variation before
  choosing a `VARC` path or static fallback.
- **Component capability diagnostics:** export preflight can compare component
  recipes with a target capability profile before invoking a backend. This is
  evidence for backend or `fontc` policy, not a local compiler plan: it tells
  the app which authored Shift semantics are present, while the backend decides
  whether to preserve them, lower them, decompose, materialize generated
  sources, or reject the export. The query still lets the app show exact
  unsupported capabilities per glyph, layer, component, and evaluated condition
  when a concrete context is provided. A summary query also returns
  total/supported/unsupported component counts, affected glyph count, and counts
  per missing capability plus an explicit readiness state, so export UI can make
  a fast proceed/fallback/fail decision without re-walking every diagnostic or
  inferring policy from counts.
  `ShiftComponentLoweringTarget::plain_components()` means the target can only
  preserve ordinary static component references. It does not mean "fontc will
  solve variable components." A static export path can still choose to lower
  active variable or conditional recipes first, then hand the lowered static
  result to a plain-component target.
  Static-instance preflight can pass a concrete location; active conditions are
  resolved away before capability comparison, while inactive conditional
  components are skipped and counted separately with stable IDs, required
  capabilities, and the evaluated condition tree that made them inactive.
  `component_static_export_preview()` turns the same concrete-location evidence
  into package-wide app-facing dispositions: preserve an ordinary reference,
  skip an inactive component, require Shift-side fallback before `fontc`, or
  block on an unsupported variation resolver. The layer-scoped
  `component_static_export_preview_for_layer()` variant uses the same rules for
  inspectors. Components that require fallback carry their resolved axis values,
  resolved transform, variation source/resolution, missing authoring
  capabilities, and the exact transform fields that vary, so the backend can
  choose decomposition, materialized helper glyphs, or a future
  variable-component export path. The preview also aggregates glyph counts by
  disposition, fallback capabilities, per-capability component counts,
  stable unsupported-reason-kind counts, and detailed unsupported-reason counts,
  with an explicit readiness state (`ready`, `readyWithSkippedInactive`,
  `requiresFallback`, or `blockedByUnsupportedComponents`), so export UI can show
  the reason summary without walking every component row.
  Context-aware preflight can pass separate root font and current parent
  locations for recursive component checks. Conditions use the font location,
  matching component preview and keeping export capability diagnostics from
  disagreeing with the renderer. Variable-font preflight can keep using the
  location-independent query that checks every recipe.
  Concrete preflight and preview locations are validated at the query boundary:
  unknown axes, non-finite values, or coordinates outside axis ranges return
  typed errors instead of producing misleading export diagnostics.
- **Component location resolution:** inspectors, preview renderers, and export
  preflight can ask how a variable component resolves sparse parent coordinates,
  explicit component overrides, reset-vs-inherit behavior, and base glyph local
  axis defaults into a concrete component location. Conditional components carry
  the same evaluated condition tree as activity queries, so this query can drive
  an inspector panel on its own. The simple query treats the supplied location
  as both the root font location and the current parent location. The contextual
  query accepts both locations explicitly, which lets recursive component
  previews model `VARC`-style behavior where conditions and reset axes use the
  font location while inherited axes and component variation interpolation use
  the current parent location.
  The resolved-location report wraps the per-component rows with the
  working-source revision and compact counts for active/inactive components and
  resolved axis-value provenance. Component inspectors can render inherit,
  reset, default, local-default, and override badges without scanning every axis
  value in TypeScript, and can drop stale async query results after a newer edit.
- **Component activity reports:** renderers, inspectors, and scrub previews can
  ask the cheaper "which components participate at this location?" question
  without resolving every variable component source. The report wraps evaluated
  condition rows with the working-source revision and compact active, inactive,
  conditional, and unconditional counts, so the app can update badges and reject
  stale async results without duplicating condition evaluation in TypeScript.
- **Component recipe reports:** inspectors, delete dialogs, and export panels
  can ask for location-independent component recipe rows plus compact counts for
  static, conditional, variable, conditional-variable, capability, variation
  source, and varying-transform states. This keeps cheap component badges and
  expensive resolved-location/state queries separate, while still letting the UI
  ignore stale async recipe responses using the working-source revision. A
  selected-component recipe report returns the same summary row for one
  component plus the working-source revision, so inspectors do not need to query
  and filter the whole layer just to refresh one selected component.
- **Component variation source resolution:** inspectors and export preflight can
  ask which authored component source applies at an exact parent location, or
  ask for an interpolated component location/transform at an in-between parent
  location, without parsing component JSON in the renderer. Conditional
  components that are inactive at the queried location report an explicit
  `inactive` resolution, include the evaluated condition tree, and skip
  variation-source interpolation. `ShiftWorkingSource` compiles
  component-variation resolvers when opened or refreshed. Fixed local-axis and
  transform recipes reuse a full `fontdrasil` model; query-dependent recipes
  such as inherited global-axis overrides reuse a `NormalizedF64VariationSpace`
  so they can rebuild per-query deltas without rebuilding variation regions.
  The resolved-state report wraps the per-component rows with the working-source
  revision and compact counts for active, inactive, base, exact-source,
  interpolated, and unsupported components, so inspectors can render badges and
  ignore stale async previews without scanning every row.
- **Authored component variation source completion:** inspectors can ask for the
  component variation source rows on a selected component and receive completed
  parent locations, resolved component-axis values, transform provenance, and
  stable source IDs. This keeps source editing UI out of package JSON while
  still showing exactly what will be saved in the owner glyph file. Component
  variation source create/update/delete reports return the updated completed
  source list and component recipe summary as well, so component inspectors and
  export-capability badges can update from the command response without
  re-parsing the glyph or making second source-list or recipe queries. The
  component variation source location report includes
  the working-source revision and compact counts for parent-location
  provenance, resolved component-axis provenance, and base-vs-source transform
  provenance, so component inspectors can render status badges and ignore stale
  async results without scanning every variation source row.
- **Glyph variation source completion:** inspectors and export preflight can ask
  for each glyph variation source's completed location and see whether every
  value came from the referenced source location, a global axis default, a
  glyph-local default, or an explicit variation-source override. Glyph variation
  source create/update/delete reports include the post-mutation completed source
  list and refreshed source coverage report, so a glyph-source inspector and
  export-readiness badge can update from the command response instead of issuing
  follow-up queries or rebuilding sparse/default provenance in TypeScript. The
  glyph variation source location report adds the
  working-source revision and compact provenance counts for source-location,
  global-default, local-default, and explicit override values, so glyph source
  inspectors and export panels can render status badges and ignore stale async
  responses without scanning every source row.
- **Source location completion:** source panels and export preflight can ask for
  every source's completed global location and see whether each coordinate was
  explicit or inherited from an axis default. Each source row also carries
  `isDefaultSource`, so the renderer can show the canonical source, block
  destructive actions, and route quick glyph creation without inspecting the
  manifest or duplicating default-source policy. The same surface backs source
  create/update/delete reports, so UI can immediately refresh source lists,
  source badges, and interpolation compatibility summaries from validated Rust
  state rather than patching local JSON-shaped records. The source-location
  report includes the working-source revision and compact counts for explicit
  source coordinates versus axis-default coordinates, so source editors can
  render summary badges and discard stale async results without scanning every
  source row in TypeScript.
- **Glyph interpolation compatibility reports:** glyph grids, inspectors, and
  export panels can ask for one glyph's derived interpolation compatibility with
  the working-source revision, compact compatible/layer/issue counts, issue-kind
  counts, and the detailed compatibility record. The app can therefore show
  variable-font warnings for a selected glyph and discard stale async results
  without scanning the package-level compatibility index in TypeScript.
- **Compatibility mutation updates:** glyph create/rename/delete, source
  create/update/delete, glyph source layer create/delete, glyph
  variation-source create/update/delete, and component variation-source
  create/update/delete reports include a compact interpolation-compatibility
  update. It carries the working-source revision, package-level compatibility
  summary, precise affected glyph rows when the change is glyph-scoped, removed
  glyph IDs for deletes, and an `invalidatesAllGlyphs` flag when a broad source,
  axis, mapping, or manifest change means renderer caches should refresh the
  package-level compatibility view. The app can patch grid badges, inspector
  warnings, and export preflight counts from the mutation response without
  shipping the full package-wide compatibility index or keeping stale
  variable-font state until a follow-up query completes.
- **Source layer coverage:** source panels can ask which glyphs have a layer for
  each family source, which glyphs are missing that layer, and which
  interpolation compatibility issues involve that source. Coverage rows include
  default-source status, reference issue counts, mismatch issue counts,
  affected-glyph counts, and issue-kind counts split by all/reference/mismatch
  roles. A report query returns the compact summary and detailed source rows
  together for screens that need both, avoiding duplicate renderer calls and
  duplicate Rust scans. The compact summary reports total
  expected/present/missing layers, ready sources, sources needing work, sources
  with missing layers, sources with interpolation mismatches, readiness buckets,
  and package-wide interpolation issue-kind counts so the app can render
  source-sidebar or export-readiness badges without rebuilding the aggregation
  in TypeScript. The app can use the explicit
  readiness state for source-row badges while still showing reference-only
  context when a canonical source is involved in other layers' failures. It can
  distinguish "this source is the canonical reference for other broken layers"
  from "this source is the layer that needs work," distinguish "one glyph has
  several fixes" from "several glyphs are broken," and separate contour topology
  work from component relinking or component-count fixes directly in the source
  list. This makes "new master added but not populated yet" a first-class state
  instead of a validation failure or a TypeScript-side scan. A compact worklist
  query returns only the sources that need work, their default-source status,
  readiness state, missing layer counts and sample glyphs, interpolation
  mismatch counts, affected glyph counts and sample glyphs, and mismatch
  issue-kind counts, so source sidebars and export checklists can show the
  prioritized fix list without walking full glyph/source detail rows.
- **Variable-font readiness:** app chrome and export panels can ask for one
  package-level variable-font readiness state: `singleSource`, `ready`,
  `missingSourceLayers`, `interpolationIncompatible`, or
  `missingSourceLayersAndInterpolationIncompatible`. The report reuses the
  source coverage summary as evidence, so the UI can enable variable operations
  from a stable Rust-owned status while drilling into the existing source rows
  and interpolation issues for details. Source coverage reports include this
  readiness directly, so mutation reports that already return coverage can
  refresh variable-operation affordances without a follow-up query or
  TypeScript-side status derivation. Variable-font export preflight also carries
  a primary action, compact top-level summary, the compact source worklist, and
  source mapped-location diagnostics next to component preflight diagnostics, so
  a blocked export panel can choose the next step, render counts, and explain
  source blockers, mapping blockers, and component blockers from one Rust-owned
  response.
- **Coverage and label mutation reports:** source create/update/delete, glyph
  rename/create/delete, glyph source layer create/delete, and glyph variation
  source create/update/delete reports include the same source coverage report
  after the mutation. A source sidebar or export-readiness badge can therefore
  update from the command response that changed the graph or glyph labels,
  instead of issuing a follow-up query or predicting coverage changes in
  TypeScript. Source create/update/delete reports also include refreshed source
  location and source mapped-location reports, so source panels can update
  authored coordinates, mapped construction coordinates, and mapping diagnostics
  from the same response that changed the source list.
- **Source deletion preflight:** source deletes use the same preview data as the
  UI before constructing a candidate package. Default sources and referenced
  sources return semantic errors with reference counts, so the app can show a
  stable warning instead of interpreting lower-level validation failures.
- **Glyph source layer creation:** source panels can add a missing glyph layer
  for a declared source through a semantic command. The command refuses to
  overwrite an existing layer, validates the candidate package before swapping
  live state, and reports a narrow `UpdateGlyph` diff so incremental saves touch
  only the owner glyph plus derived indexes.
- **Glyph source layer deletion:** source panels can preview and delete one
  glyph's layer for a declared source without hand-editing package JSON. The
  delete command refuses to remove a layer still used by glyph-local variation
  source rows, then reports a narrow `UpdateGlyph` diff so saves touch only the
  owner glyph plus derived indexes.
- **Axis mapping resolution:** source-level user-axis to construction-axis
  mappings can be queried in Rust. One-dimensional mappings interpolate between
  samples; multi-axis mappings use the same `fontdrasil` variation model as
  glyph/component interpolation. This lets source panels preview avar2-style
  many-input-to-many-output mapping behavior without TypeScript rebuilding a
  separate interpolation stack. `ShiftWorkingSource` compiles those mapping
  resolvers when opened or refreshed, so scrubbing a variable location reuses
  the same model instead of rebuilding it per frame. Axis mappings can be
  created, updated, and deleted through semantic working-source commands; each
  command validates the candidate package, swaps query views atomically, and
  reports the `axis-mappings.json` write impact plus derived-cache invalidation.
  The axis mappings report lists mapping rows with static/one-dimensional/
  multi-dimensional kind, input/output axis references, sample counts, and a
  compact package-level summary that separates unique axes from per-mapping axis
  references. Mapping panels and export preflights can render avar2 authoring
  status from a revision-stamped Rust-owned response instead of inspecting
  `axis-mappings.json` or rebuilding mapping metadata in TypeScript. Axis
  mapping create/update/delete reports include this refreshed mapping report and
  refreshed source mapped-location report, so app panels can update mapping
  rows, mapped master coordinates, and mapping diagnostics from the command
  response that changed the mapping graph.
  Source mapped-location reports apply the same mapping resolvers to each
  declared source location and return both authored source coordinates and
  mapped construction coordinates with aggregate diagnostic counts. Source
  panels can therefore show whether a master is outside an authored mapping
  range before export, without querying every source location one at a time.
  The mapped-location report wraps resolved axis values and mapping diagnostics
  with the working-source revision plus compact counts for input, default,
  mapped, applied-mapping, and diagnostic states. Variable sliders and export
  panels can therefore show mapping status and discard stale async results
  without scanning every resolved axis or diagnostic in TypeScript.

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
- Shift should keep stable IDs canonical even where prior UFO-oriented proposals
  use glyph names for symmetry with existing `<component base="...">` data.
  Names are editable labels and export/interchange aliases. Component targets,
  glyph-local sources, dependency indexes, rename/delete previews, and save
  impact should all remain ID-keyed so app edits do not require reconstructing
  identity from mutable labels.
- Shift should reject or disambiguate authoring states that prior art marks as
  complicated open questions. In particular, glyph-local axes must not shadow
  global axes by display name or stable ID. A component location may reference
  global and base-local axes at the same time, but every coordinate is keyed by
  stable axis ID so source validation, editor inspection, and export lowering
  agree on which axis is being controlled.
- `VARC` separates the root font coordinates from the current parent component
  coordinates. Shift exposes that distinction through
  `ShiftComponentResolveContext`: component conditions and
  `resetUnspecifiedToFont` read the font location, while inherited sparse axes
  and parent-location interpolation read the current parent location. This keeps
  recursive preview/export behavior from accidentally collapsing reset and
  inherit into the same state.
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

Component transforms use the same decomposed field set as Fontra variable
components and `VARC`: translation and transformation-center values are in font
units, while rotation and skew are stored in degrees. Matrix composition is:
translate by `translate + center`, rotate, scale, skew by `(-skewX, skewY)`,
then translate by `-center`. Binary export can convert those degrees into the
target representation, but source files keep the authoring units designers edit.

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
  dependents. Dependent previews include component recipe summaries, so the app
  can warn when a removal would discard conditional participation, variable
  locations, transform variation, reset/inherit behavior, or authored component
  variation sources. These summaries are resolved from the dependency-index
  dependent list, so preview cost scales with the affected components rather
  than every component in the package. Relink options can also be previewed
  against a candidate replacement before commit, returning the prospective diff
  and relinked recipe summaries without mutating the working source.
  Replacement candidate queries can pre-filter the picker with cycle and
  base-local-axis blockers, so the app does not have to trial-run every glyph
  through a full relink preview. Candidates are returned in glyph-name order for
  stable picker rendering, and cycle blockers include transitive component
  dependencies. The candidate report carries the working-source revision plus
  compact counts for relinkable, blocked, cycle-blocked, missing-local-axis, and
  out-of-range-local-axis candidates, so the picker can render status and reject
  stale async results without scanning every row.
  Component-removal delete also has a dedicated preview, so the app can show the
  exact destructive write impact before removing dependent component recipes.
  Rename, delete, source-delete, and glyph-source-layer-delete previews carry
  the working-source revision, giving the app a uniform stale-confirmation guard
  for every dialog that can lead to a destructive or identity-changing command.
- Conservative delete commands that fail before mutation when component
  dependents, source layers, or source-owned variation rows still exist, plus an
  explicit component-removal delete command for the destructive "remove those
  uses too" path and an explicit relink delete command that retargets dependent
  components to another base glyph while preserving their conditional and
  variable component recipes. Relink delete is still validation-gated and
  transactional: if the replacement would introduce a component cycle or cannot
  satisfy retained base-local component axes, the command returns a typed error
  without advancing the working-source revision.
- Sidebars and badges backed by derived indexes instead of repeated full scans.
- Variable component inspectors that show inherited values, explicit overrides,
  local axes, and active/inactive conditions with the condition subtree that
  caused the current active state.
- Component recipe lists that can quickly identify static, conditional,
  variable, and conditional-variable components before asking for current
  location state, including which export capabilities each recipe requires.
  Transform-only component variation reports `variableTransform` without
  incorrectly requiring `variableLocation`, so backend preflight can accept
  targets that preserve varying transforms but do not need component-axis-value
  variation. A neutral authored component source whose transform equals the
  base component transform remains visible as a variation source, but it does
  not require `variableTransform` on its own. Likewise, an authored component
  axis value that matches the value the component would already use at that
  variation source stays visible in the source graph without requiring
  `variableLocation` on its own. For inherited components, that baseline is the
  parent location plus explicit component overrides. For reset components, the
  location-independent summary uses the font-axis default plus explicit
  component overrides.
- Target capability diagnostics that tell export UI whether the chosen backend
  can preserve conditions, variable component locations, variable transforms,
  and reset-vs-inherit axis semantics before any compiler runs. The app can
  render a compact summary first and expand into per-component diagnostics only
  when the user needs details.
- Static-instance export preflight that uses the same condition evaluation as
  preview, so unsupported inactive recipes do not block a concrete instance but
  are still counted as skipped for explainability.
- Package-wide static export previews that let export UI distinguish "these
  components can stay normal references" from "these components are visually
  resolvable but need backend fallback before `fontc`" from "these components
  cannot be resolved without fixing the source graph or interpolation model,"
  with affected glyph counts, fallback reason counts, stable unsupported blocker
  categories, and detailed unsupported reason counts for compact banners.
- Current-location previews that use the same condition evaluation rules as
  save/export preflight, with the same query-location validation as export
  preflight and axis-mapping previews.
- Component recipe UI that can label each resolved axis value as coming from the
  parent location, font location, font default, base local default, or component
  override.
- Component recipe UI that can show exact authored component variation sources:
  completed parent locations, which source changed the component location and
  transform fields, and stable source IDs for future edit/delete commands.
  Mutation reports for those authored sources include the post-mutation recipe
  summary, including required lowering capabilities, so the app can refresh
  variable-component warnings immediately after an edit.
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
  touch before the staged writer commits them, with canonical source paths
  counted separately from derived cache paths.

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

`ShiftWorkingSourceSaveSummary` mirrors the same boundary at app level:
`canonicalPathCount` and `removedCanonicalPathCount` describe persisted source
data, while `derivedPathCount` describes disposable cache/index impact. This
keeps save buttons, dirty badges, and data-loss warnings from treating a cache
rewrite the same as a canonical source edit. `conflictKindCounts` and
`conflictPathClassCounts` provide the same compact grouping for external
changes detected during save preview. `stagedRecoveryActionCounts` similarly
summarizes pending staged transactions by recovery action, while
`stagedRecoveryLiveStateCounts` summarizes the on-disk state those policies are
responding to.

Examples:

```text
RenameGlyph(glyph_A)
  canonical: glyphs/glyph_A.json
  derived:   derived/dependencies.json
             derived/interpolation-compatibility.json

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

UpdateManifest
  canonical: manifest.json
  derived:   derived/interpolation-compatibility.json

UpdateAxisMappings
  canonical: axis-mappings.json
  derived:   derived/interpolation-compatibility.json
```

The important behavior is that a glyph rename does not relink dependents.
Components target `baseGlyphId`, so the rename changes the renamed glyph file
and refreshes dependent component `baseGlyphName` label caches. Rename also
refreshes interpolation compatibility because that derived index carries
app-facing glyph labels. A component label-cache update remains dependency-only:
compatibility signatures use stable IDs, not cached display names. A manifest
update refreshes interpolation compatibility because the manifest owns the
package `defaultSourceId`, and the compatibility index uses that source as the
preferred diagnostic reference layer.
edit is different: it changes the owner glyph's semantic component recipe and
invalidates interpolation compatibility because the graph may have changed.

The diff API preserves that distinction:

```text
old glyph_A.name = "A"
new glyph_A.name = "A.alt"
  -> RenameGlyph(glyph_A)
  -> UpdateGlyphLabels(glyph_Aacute)

old glyph_Aacute.width = 600
new glyph_Aacute.width = 620
  -> UpdateGlyph(glyph_Aacute)
```

This matters for app behavior. A rename can show a cheap dependency-label
refresh that keeps package files readable while refreshing the compact
interpolation-compatibility rows that carry app-facing glyph labels. A component
or outline edit can mark interpolation compatibility and dependency views stale.
The save path does not need to guess from raw files.

The staged writer turns this impact plan into verified payloads, backups,
validation, and recovery markers. The package model gives that writer the
narrow write set and a prepared commit object, so save can be incremental
without inferring intent from raw files.

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
  -> WriteFile(derived/interpolation-compatibility.json, derived)

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

This is the durable save handoff. Higher-level document services can wrap it,
but they should preserve the same prepare -> stage -> apply -> mark-saved
boundary.

`stage_prepared_commit()` is the next handoff step. It refuses prepared commits
with unresolved conflicts, writes all canonical and derived payloads under
`.shift-txn/<id>/payloads/`, then writes `commit.json` into
`.shift-txn/<id>/`. Every staged payload is checked against the size/hash
recorded in the prepared operation. Payloads and the marker are written through
same-directory temp siblings, synced, renamed into place, and followed by a
best-effort parent-directory sync. It does not replace live files. Staging gives
recovery a concrete marker and verified bytes before any live mutation starts.

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

`recover_staged_commits()` is the non-interactive startup helper for the safe
cases. It resumes transactions whose plan is `resume`, cleans transactions whose
plan is `cleanup`, and refuses to mutate when any transaction is
`blockedByLiveConflict` or `cannotRecover`. After it succeeds, `load_package()`
can trust the live package files.

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
  -> previewPackageLoad(root)
  -> recoverStagedCommits(root) when every plan is resume/cleanup
  -> prompt when any plan is blockedByLiveConflict/cannotRecover
  -> loadPackage(root)
open package
  -> ShiftWorkingSource::open_saved(root, package)
edit through working-source semantic operations
  -> previewSave(root)
  -> render unchanged/ready/blockedByExternalChanges/blockedByStagedCommit
     from summary, prepared, and recovery evidence
save
  -> ShiftWorkingSource::save(root)
       prepares, stages, applies, then markSaved(root)
```

The lower-level `stage_prepared_commit()` and `apply_staged_commit()` remain
available for tests, recovery tooling, and explicit writer orchestration, but
the desktop app should prefer `ShiftWorkingSource::save()` for ordinary saves so
it cannot forget to refresh the saved baseline after a successful commit.

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
  "glyphCount": 1,
  "compatibleGlyphCount": 0,
  "incompatibleGlyphCount": 1,
  "issueCount": 1,
  "issueKindCounts": [
    {
      "kind": "contourTopologyMismatch",
      "issueCount": 1
    }
  ],
  "glyphs": {
    "glyph_A": {
      "glyphId": "glyph_A",
      "glyphName": "A",
      "compatible": false,
      "referenceLayerId": "source_Regular",
      "issueCount": 1,
      "issueKindCounts": [
        {
          "kind": "contourTopologyMismatch",
          "issueCount": 1
        }
      ],
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
          "referenceLayerId": "source_Regular",
          "layerId": "source_Bold",
          "expected": "on-on:closed",
          "actual": "on-on-off:closed"
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

Diagnostics use the package default source as the reference layer whenever the
glyph has that layer. Partial glyphs that do not yet have the default layer fall
back to deterministic layer order. This keeps source panels and export preflight
warnings anchored to the canonical master instead of depending on map ordering.
Each glyph compatibility record stores the selected `referenceLayerId`, so
compatible glyphs and glyphs with only summary badges still expose the same
diagnostic anchor without forcing the app to inspect issue rows.

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
  `baseGlyphName` is a canonical label cache, not the component target.
  Working-source rename commands refresh dependent component labels through
  narrow `UpdateGlyphLabels` writes, so app surfaces and package files stay
  readable after a rename without relinking component identity.
- Glyph-local axes, variable component locations, axis inheritance, and
  conditions now project into `shift-ir`. Component locations stay ID-keyed
  because they can reference glyph-local axes as well as global axes. Component
  and glyph variation source recipes still need deeper IR modeling before they
  can drive ordinary editor behavior.
- Export/build diagnostics are not wired through the `shift-backends`/`fontc`
  path yet, but the source model now rejects out-of-range authored coordinates
  before backend export.

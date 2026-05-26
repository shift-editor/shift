# Shift Source Spike Dogfood Evaluation

## Goal

Decide whether the `shift-source` spike should become product architecture by testing real editor workflows against safety, app ergonomics, performance, save/recovery behavior, and variable-font expressiveness.

This is not a decision to ship `.shift` as a user-facing file format. The first decision is whether Shift should move toward a Rust-owned document/source service.

## Thesis To Test

```text
Rust document service owns font/source truth and safety.
shift_ir owns live editing/rendering concepts.
N-API exposes app-shaped commands and reports.
TypeScript owns UI projection only.
```

The spike passes only if real workflows become safer and simpler than the current model.

## Freeze Rule

Until the flows below have verdicts:

- do not add source-format features
- do not broaden report payloads
- do not expand `.shift` schema surface
- do not merge the spike as a product feature
- only change code when a dogfood flow exposes a concrete gap

## Required Flows

### 1. Metadata Edit, Save, Reopen

User action:

- edit family name, style name, UPM, ascender, descender, x-height, cap height, underline data, or italic angle
- preview save
- save
- reopen

Pass criteria:

- one semantic Rust command performs the edit
- metadata validation happens before mutation
- save impact is narrow and only touches metadata payloads plus necessary indexes
- glyph files are not rewritten
- saved state clears only after disk graph matches the working graph
- reopen returns the edited metadata
- external edits block save instead of being silently overwritten

Fail signals:

- TypeScript assembles package JSON
- edit rewrites unrelated glyph/source files
- save clears dirty state before disk validation
- app needs follow-up queries for common metadata UI state

### 2. Quick-Add Glyph And Rename Component Base

User action:

- quick-add `newGlyph`
- rename it to a useful name
- use it as a component base
- rename the base glyph again

Pass criteria:

- glyph creation allocates stable file-safe ID and collision-safe display name
- optional default layer is created through Rust
- rename changes label, not durable identity
- component targets remain stable by glyph ID
- component readable label caches refresh from Rust-owned command result
- dependency badges can update from command response
- stale rename/delete confirmations are rejected by revision

Fail signals:

- component base identity has to be reconstructed from glyph names
- TypeScript scans glyphs to rebuild dependents
- rename rewrites unrelated source data
- grid cannot update from the mutation response

### 3. Add Source/Master And Fill Missing Layer

User action:

- add a source/master
- set a sparse axis location
- inspect missing source layers
- add one missing glyph layer

Pass criteria:

- source create/update/delete are stable-ID semantic commands
- source locations are completed by Rust with provenance
- mapped source locations and diagnostics come from Rust
- source coverage/readiness updates from command reports
- interpolation compatibility invalidation is explicit
- adding a glyph source layer refuses overwrite and validates before mutation
- save impact is source metadata or owner glyph only, plus derived indexes

Fail signals:

- TypeScript computes missing master/layer state
- source readiness is a heuristic over raw package data
- app needs N per-glyph bridge calls to render source panel badges
- invalid source location partially mutates state

### 4. Variable Component Inspect And Resolve

User action:

- inspect a component with sparse location, reset/inherit behavior, condition tree, transform variation, and a base glyph-local axis
- scrub a location
- resolve component state for the current preview/export context

Pass criteria:

- component identity and base glyph identity are stable IDs
- root font location and parent component location remain distinct
- reset/inherit behavior is named consistently across source, IR, DTO, and UI
- inactive conditional components are explicitly reported and skipped for expensive resolution
- resolved axis values include provenance
- transform variation reports which fields vary
- local axes are explicit and do not shadow global axes by name
- UI can explain active/inactive state without duplicating condition semantics

Fail signals:

- TypeScript evaluates condition trees
- app cannot explain reset versus inherit
- variable component data exists only in source package but not in usable IR/query shape
- scrubbing requires package-sized DTOs or per-component N-API loops

### 5. Save Conflict And Recovery

User action:

- open a source package
- make an edit
- simulate an external file change
- preview save
- simulate a staged transaction, partial apply, or cleanup-only transaction
- reopen

Pass criteria:

- save preview reports unchanged, ready, blocked-by-external-changes, or blocked-by-staged-commit
- conflict summaries split canonical source paths from derived cache paths
- active staged transactions block save
- mark-saved reloads from disk and checks semantic equality before refreshing baseline
- interrupted staged commits are recovered or blocked explicitly
- load never accepts a mixed old/new graph as clean
- failure states are typed and user-presentable

Fail signals:

- save overwrites external edits
- dirty state is cleared by an old save result
- load trusts canonical files while staged metadata indicates uncertainty
- recovery decisions live in TypeScript

## Optional Flows

### 6. Axis Mapping Preview

User action:

- define a public `wght` axis
- define an internal construction axis such as `stem`
- add a mapping from public to internal coordinates
- inspect mapped source locations

Pass criteria:

- mapping commands validate before mutation
- one-dimensional and multi-axis mappings use cached Rust resolvers
- mapped source rows include diagnostics such as outside-sample-range
- TypeScript does not run interpolation or infer construction coordinates
- export preflight can treat mapping diagnostics as source-readiness blockers

### 7. Export Preflight

User action:

- ask whether the current package can export a static instance or variable font

Pass criteria:

- one readiness enum drives app control flow
- report includes source blockers, mapping blockers, component blockers, and exact details
- component target profile is explicit rather than inferred from a string format
- fontc/export lowering remains backend-owned
- source package reports intent and blockers, not artifact policy

## Scorecard

For each flow, record:

| Field | Notes |
| --- | --- |
| User action | What the designer does |
| Rust command/query | Exact command or query used |
| DTO/report returned | App-shaped response |
| TypeScript state touched | UI projection only |
| N-API call count | Should be coarse |
| Payload size concern | Screen-sized, not package-sized |
| Save impact | Canonical writes, removals, derived invalidations |
| Stale revision handling | How stale dialogs/responses are rejected |
| Typed failure states | User-presentable blockers |
| Better than current path? | Yes/no with reason |
| Verdict | Keep, simplify, park, or cut |

## Initial Evidence Snapshot

This snapshot records what the spike currently proves in Rust and what remains unproven until the editor dogfoods the flow. Rust unit coverage is necessary, but it is not enough to graduate the spike: each required flow still needs one app-level pass through `shift_ir`, bridge DTOs, N-API, renderer state, save, and reopen.

### 1. Metadata Edit, Save, Reopen

Current evidence:

- `ShiftWorkingSource::update_font_info` edits the font payload through one semantic command and returns `ShiftUpdateFontInfoReport` with `font`, `diff`, and `revision`.
- Save APIs expose `preview_save`, `save`, and `mark_saved`.
- Save preview is typed as `Unchanged`, `Ready`, `BlockedByExternalChanges`, or `BlockedByStagedCommit`, with a primary action for app control flow.
- Existing Rust tests cover narrow font info impact, invalid font info rejection, no-op revision behavior, save persistence, external conflict blocking, staged commit blocking, and mark-saved mismatch handling.

Still unproven:

- Whether the current Electron/TS font info dialog can be driven by one bridge mutation plus one revisioned response.
- Whether the UI can avoid rebuilding package-shaped state after a metadata edit.
- Whether reopen is tested through the same path the app will use for dogfooding, not only package-level Rust load/save tests.

Next dogfood step:

- Wire one metadata field group to the Rust document service and measure the response payload, bridge call count, dirty-state transition, save summary, and reopen result.

### 2. Quick-Add Glyph And Rename Component Base

Current evidence:

- `ShiftWorkingSource::create_glyph` allocates a stable glyph ID, collision-safe display name, optional default layer, dependency report, interpolation compatibility update, source coverage report, diff, and revision.
- `ShiftWorkingSource::preview_rename_glyph` and `rename_glyph` operate by glyph ID.
- `rename_glyph` changes the readable glyph name and refreshes cached component base glyph names while component targets remain stable by glyph ID.
- Destructive paths include `preview_delete_glyph`, `delete_glyph`, `delete_glyph_and_remove_component_references`, and `delete_glyph_and_relink_component_references`.
- Existing Rust tests cover ID-stable rename, component target stability after glyph name change, dependency label refresh, duplicate/missing rename preview rejection, delete previews, component removal, relink, cycle guards, and missing local-axis relink safety.

Still unproven:

- Whether the glyph grid, selection model, inspector, and component badges can update from command reports without TS scanning the whole font.
- Whether stale destructive dialogs are rejected at the bridge/app boundary using the response revision.
- Whether existing TS component editing can be moved away from editable base glyph names without leaving a parallel truth.

Next dogfood step:

- Build a dogfood flow for add glyph -> add component -> rename base -> preview delete. Treat any TS-side dependency reconstruction as a failure signal.

### 3. Add Source/Master And Fill Missing Layer

Current evidence:

- Source operations are split into `create_source`, `update_source`, and `delete_source`.
- Create/update source reports include source locations, mapped source locations, interpolation compatibility, source coverage, diff, and revision.
- Glyph layer operations include `create_glyph_source_layer`, `delete_glyph_source_layer`, and delete previews for source-layer references.
- Existing Rust tests cover generated source IDs, blank-name fallback, source updates, default-source deletion blockers, referenced/unreferenced deletion previews, source layer coverage, variable font readiness, source mapped location diagnostics, glyph source layer create/delete, and overwrite/refuse behavior.

Still unproven:

- Whether the sources/masters UI can render missing layers and readiness from one report instead of per-glyph bridge queries.
- Whether sparse source locations and completed/defaulted coordinates are expressed clearly enough for inspector UI.
- Whether compatibility invalidation is granular enough for interactive editing, especially on large families.

Next dogfood step:

- Dogfood add source -> inspect coverage -> add missing glyph layer -> save. Record whether UI badges, source table rows, and compatibility warnings are all driven from Rust reports.

### 4. Variable Component Inspect And Resolve

Current evidence:

- Component queries include `component_activity`, `component_activity_report`, `component_recipes`, `component_recipe`, and their report forms.
- Component variation source mutations return updated component source locations, component recipe, interpolation compatibility, diff, and revision.
- Existing Rust tests cover parent versus root font locations, reset font location, local axes, exact variation source state, condition trees, inactive component skipping, transform variation summaries, and variation-model interpolation.

Still unproven:

- Whether these reports are app-shaped enough for the inspector, scrubber, canvas preview, and export preflight without package-sized DTOs.
- Whether `shift_ir` contains the same variable component concepts the editor needs for selection, rendering, undo, and preview.
- Whether scrubbing can reuse cached Rust-side state and return screen-sized deltas instead of full component/package payloads.

Next dogfood step:

- Build a variable component inspector/scrub flow against one dogfood glyph. Measure bridge calls per scrub frame, payload size, and whether TS evaluates any condition or reset/inherit semantics.

### 5. Save Conflict And Recovery

Current evidence:

- Save is staged through prepared commits, staged commits, apply, cleanup, fingerprint comparison, and recovery plans.
- `preview_save` blocks active staged commits before reporting external-change readiness.
- `mark_saved` refuses active staged commits, validates the working package, reloads disk, checks semantic equality, then replaces the saved baseline/fingerprint.
- Existing Rust tests cover pending/partially applied/applied/diverged/invalid staged transactions, recovery, load refusal before trusting uncertain staged state, external conflict blocking, active staged commit blocking, and save-without-changes baseline refresh.

Still unproven:

- Whether the desktop app can present every save/recovery state without inventing additional state in TS.
- Whether save failures leave renderer dirty state and command history coherent.
- Whether crash recovery has been exercised through the actual dogfood package path, including reopening from the app shell.

Next dogfood step:

- Add a manual or scripted dogfood scenario that mutates files outside the app, simulates staged transaction states, then opens/previews/saves from the app and records the exact user-presentable recovery state.

### 6. Axis Mapping Preview

Current evidence:

- Axis mapping operations are split into `axis_mappings_report`, `create_axis_mapping`, `update_axis_mapping`, and `delete_axis_mapping`.
- Mapping reports feed mapped source locations and diagnostics.
- Existing Rust tests cover first-class package roundtrip, mapping summary shapes, generated mapping IDs, update/delete, multi-axis interpolation, defaults, outside-sample diagnostics, mapped source locations, and export preflight interactions.

Still unproven:

- Whether the public/internal coordinate model makes sense in the app UI.
- Whether mapping edits can be previewed interactively without recomputing package-sized state in TS.
- Whether mapping diagnostics should block export directly or appear as advisory readiness issues.

Next dogfood step:

- Use a dogfood family with one public axis and one construction axis. Edit mapping samples, inspect mapped source rows, and check if source readiness/export preflight react without TS-side interpolation.

### 7. Export Preflight

Current evidence:

- `variable_font_readiness_report` and `variable_font_export_preflight` report source, mapping, and component blockers from Rust.
- Component lowering diagnostics can target explicit capability profiles instead of inferring policy from a string format.
- Existing Rust tests cover variable font readiness, export preflight, and component lowering diagnostics.

Still unproven:

- Whether this is the right boundary with `fontc`/`fontir`: Shift source should report intent and blockers, while fontc owns artifact lowering and binary font policy.
- Whether the app needs export-oriented reports now or only readiness summaries until a `shift2ir`/fontc handoff exists.

Next dogfood step:

- Treat export as a preflight-only app surface for now. Do not build Shift-to-UFO export as a success criterion; binary export through fontc is the relevant product direction.

## Dogfood Instrumentation

Every required flow should capture these measurements before the spike graduates:

- bridge call count per user action
- serialized DTO byte size for command response and follow-up queries
- Rust command/query duration
- renderer state objects touched
- dirty-state transition and expected revision
- save summary path counts and conflict counts
- whether TS evaluated domain semantics that Rust should own
- whether reopening from disk reproduces the same app-visible state

The app should fail the flow if it needs raw package traversal, per-glyph bridge loops for panel state, name-based component repair, TypeScript save/recovery logic, or package-sized responses during interactive scrubbing.

## Pass Criteria

A flow passes only if:

- one user action maps to one semantic Rust command/query
- TypeScript renders the answer and does not reconstruct source semantics
- responses are revision-stamped
- save impact is explicit and narrow
- failure states are typed and user-presentable
- N-API crossings are coarse enough
- behavior is clearly better than the current designspace/UFO path

## Decision Rule

Keep or merge:

- stable IDs
- semantic commands
- destructive previews
- revision-stamped reports
- narrow write impact
- save/recovery model
- Rust-owned dependency and readiness queries
- app-usable variable component semantics

Park or cut:

- `.shift` as a user-facing file format
- broad speculative reports
- export policy not proven through UI
- operation surfaces not pulled by dogfood flows

## Expected Outcome

The spike succeeds if it proves this loop:

```text
User action
  -> one Rust command/query
  -> validated source graph mutation or typed blocker
  -> revisioned app-shaped DTO
  -> narrow save impact
  -> TypeScript renders state, without deriving source semantics
```

If that loop holds, the Rust document service is worth carrying forward even if `.shift` remains experimental.

If that loop does not hold, harvest the useful ideas and cut the spike back aggressively.

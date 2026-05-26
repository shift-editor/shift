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

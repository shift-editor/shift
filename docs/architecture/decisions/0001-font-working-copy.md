# ADR 0001: Font Working Copy Owns Document State

Date: 2026-05-24

Status: Proposed

## Context

Shift currently has overlapping owners for document state:

- the Rust bridge owns canonical font data plus `live_version` and `persisted_version`
- `Editor` and `Font` expose domain APIs and fine-grained signals
- `Document` coordinates create, open, save, export, close, and persistence identity
- the Zustand app store owns file path, file name, dirty state, and service access
- some UI/domain flows call `markDocumentDirty()` manually
- command history marks dirty through a callback

This makes saveability easy to get wrong. In particular, clearing dirty state after an async save can lie if a newer edit happens while the save is in flight. The bridge already has the better model: a save persists a specific snapshot version, and the document is dirty when the saved version is older than the live version.

We also need a cleaner vehicle for upcoming font metadata editing. Editing family name, style name, version fields, and source names should exercise the same document-state path as glyph edits: mutate the canonical model, advance the document revision, update UI projections, save, reopen, and export without special UI bookkeeping.

## Decision

Introduce a renderer-side `FontWorkingCopy` document model.

`FontWorkingCopy` owns document lifecycle and saveability for the currently open font:

- create untitled font
- open file-backed font
- save and Save As
- export
- close
- file identity
- current and saved document revisions
- derived dirty state
- last save/export error state

Dirty state is derived, not manually set:

```ts
$dirty = computed(() => $savedRevision.value < $currentRevision.value)
```

No renderer code should call `setDirty(true)`, `setDirty(false)`, `markDirty()`, or `clearDirty()` as the source of truth. Model mutations advance the live/current revision. Successful save records the persisted/saved revision returned by the bridge. The dirty projection follows from those revisions.

Bridge mutations that can commit font-model changes should return a mutation result that includes the current document revision and whether the mutation changed committed data. The renderer should not call a separate `getLiveVersion()` after each mutation just to discover what happened.

```ts
interface DocumentMutationResult {
  changed: boolean;
  revision: number;
}
```

No-op mutations return `changed: false` and the unchanged revision. Changing mutations return `changed: true` and the revision after the bridge has advanced it. This keeps event payloads explicit, avoids renderer-side version polling, and gives tests a direct way to assert revision behavior.

## Boundaries

### Rust bridge

The bridge remains the canonical owner of font data and persistence versions.

Responsibilities:

- mutate committed font data
- bump `live_version` when committed font data changes
- save a snapshot and record that snapshot version as persisted
- expose revision/dirty queries and mutation results to the renderer

The bridge should not know about React, Electron windows, menus, or app chrome.

### Editor and Font

`Editor` and `Font` are the renderer domain APIs around the bridge.

Responsibilities:

- expose font metadata, sources, glyph records, metrics, and glyph edit APIs
- update local signals after bridge mutations
- emit document facts such as `documentChanged` and `documentPersisted`
- keep glyph editing and command history domain-oriented

They should not own file identity, native window state, save dialogs, or release-facing persistence policy.

### FontWorkingCopy

`FontWorkingCopy` is the app-level working-copy model for one loaded or untitled font.

Responsibilities:

- own file identity signals (`$identity`, `$filePath`, `$fileName`)
- own revision signals (`$currentRevision`, `$savedRevision`)
- expose `$dirty` as a computed signal
- own lifecycle methods (`createUntitled`, `open`, `save`, `saveAs`, `export`, `close`)
- subscribe to editor document events and revision changes
- project file and dirty state to Electron main process
- coordinate document persistence registry updates

`FontWorkingCopy` should be saveable even when the current React route or editor view is not mounted.

### Zustand

Zustand should not own document truth.

Allowed roles:

- stable app service locator while the app is still migrating
- access to the current `FontWorkingCopy`, `Editor`, and global services
- temporary compatibility adapter for components not yet reading signals directly

Disallowed roles:

- owning dirty state
- owning file identity
- exposing `markDocumentDirty`
- deciding whether a save made the document clean

The intended direction is to remove document-state fields from Zustand once consumers read `FontWorkingCopy` signals directly.

### Signals and events

Use signals for continuous document state:

- current revision
- saved revision
- dirty
- saving/exporting
- file identity
- metadata
- sources
- glyph records

Use events for one-shot facts:

- font loaded
- font closed
- document changed
- document persisted
- save failed
- export failed

Signals are for rendering and derived state. Events are for imperative coordination across subsystems.

## Initial Implementation Vehicle: Metadata Editing

Font metadata editing is the first feature that should use the new working-copy model.

Implementation path:

1. Add bridge mutation for font metadata.
   - Accept family name, style name, version fields, and basic name-table metadata.
   - No-op if the normalized metadata is unchanged.
   - Bump `live_version` only when committed font data changes.
   - Return a `DocumentMutationResult`.

2. Add renderer `Font.updateMetadata`.
   - Call the bridge mutation.
   - Refresh local metadata signal.
   - Emit `documentChanged` when the bridge reports a changed revision.

3. Add `FontWorkingCopy`.
   - Move document identity and revision tracking out of Zustand-owned state.
   - Derive dirty from revisions.
   - Save by recording the persisted revision returned by the bridge.
   - Do not clear dirty imperatively after save.

4. Wire app shell projection.
   - Native window document edited state follows `$dirty`.
   - Native represented file follows `$filePath`.
   - Existing menu save/export/open paths call `FontWorkingCopy`, not raw editor methods.

5. Hook Font Info UI.
   - Editable family name, style name, and version fields.
   - UI calls `font.updateMetadata`.
   - UI does not mark dirty directly.

6. Prove the workflow.
   - Edit metadata.
   - Save UFO and reopen.
   - Save Designspace and reopen.
   - Export TTF and read back name data.
   - Verify dirty remains true if a later mutation happens while save is in flight.

## Consequences

Benefits:

- saveability becomes revision-based and race-safe
- document state has one owner
- app chrome mirrors document truth instead of deciding it
- metadata editing exercises the same path future source/glyph metadata edits should use
- React views become less coupled to persistence policy

Costs:

- larger renderer state migration than a local metadata form patch
- some components must switch from Zustand fields to working-copy signals
- tests must cover revision transitions, not just boolean dirty flags

## Non-Goals

- replace all Zustand usage in one pass
- support multiple open documents immediately
- redesign the full Font Info dialog
- add OTF export
- make Glyphs/GlyphsPackage writable

## Open Questions

- Should `FontWorkingCopy` live under `app/` or `lib/document/`?
- Should command history participate directly in document revision events, or should only bridge-level committed mutations emit revision changes?
- Should metadata editing be undoable in command history, or is document-level undo for metadata a later slice?

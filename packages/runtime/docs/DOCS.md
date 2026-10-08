# @shift/runtime

<!-- reviewed: 2026-10-04 review-every: 90d -->

Host-neutral capability contracts shared by Shift protocol adapters and future plugin hosts.

## Architecture Invariants

- **Architecture Invariant:** `@shift/runtime` defines capability contracts only. It owns no Electron, MCP, renderer, utility-process, persistence, or sandbox implementation.
- **Architecture Invariant:** Existing domain identities and session modes come from `@shift/types`. Runtime contracts never redeclare `AxisId`, `GlyphId`, `NodeId`, `SourceId`, or `FontSessionMode` as parallel primitives.
- **Architecture Invariant:** `ShiftCapabilities` is the reusable platform surface. MCP, plugins, browser hosts, and tests adapt that contract without exposing internal `Editor`, `FontStore`, NAPI, IPC, or database objects.
- **Architecture Invariant:** Public font data uses established scripting vocabulary: FontParts-style glyph/layer/contour/component/anchor hierarchy, designspace axes/sources/instances/locations, `info`, `advanceWidth`, and conventional affine `transformation`. Stable Shift IDs supplement names rather than replacing this hierarchy.
- **Architecture Invariant:** Every window-targeted capability returns one `ShiftObservation<T>`. Its opaque `fontRevision` identifies the authored state read by the operation; `ifFontRevision` is an optimistic precondition, never a request for retained history.
- **Architecture Invariant:** `generated/code-api.d.ts` is generated from `src/capabilities.ts` with canonical `@shift/types` dependencies bundled. It is never edited manually.

## Codemap

```text
packages/runtime/
  src/
    capabilities.ts       -- canonical capability and observation contracts
    inputs.ts             -- Zod validation of untrusted code-mode arguments
    index.ts              -- public capability types and input schemas
  scripts/
    generate-code-api.mjs -- deterministic self-contained declaration generator
  generated/
    code-api.d.ts         -- bundled declaration consumed by code-mode adapters
```

## Key Types

- `ShiftCapabilities` -- nested live operations exposed by a host.
- `ShiftSession` -- explicitly addressable live window/session identity and mode.
- `ShiftObservation`, `FontRevision`, and `ShiftTarget` -- revision-correlated result, opaque authored-state identity, and explicit window/precondition input.
- `ShiftCapture` and `ShiftCaptureTarget` -- point-in-time PNG output and its explicit `window` or `editor` target.
- `EditorInspection` -- point-in-time editor observation paired with its explicit target.
- `FontOverview`, `GlyphPage`, `GlyphSummary`, and `AuthoredLayer` -- read-only font, paged directory, stable layer references, and nested source-specific geometry.
- `ResolvedLocation`, `ResolvedGlyph`, and `ResolvedGlyphs` -- mapped location/metrics and drawable glyph output at arbitrary external coordinates.
- `AuthoredContour`, `AuthoredPoint`, `AuthoredComponent`, `AuthoredAnchor`, and `AffineTransformation` -- familiar scripting hierarchy with stable IDs and conventional component transforms.
- `LayerSvg`, `LayerOverlays`, `LayerAppearance`, and `LayerGuides` -- portable authored-layer proof output, semantic overlay selection, presentation-only overrides, and style-independent guide positions.
- `shiftInputSchemas` -- reusable runtime validation of untrusted capability inputs before IPC.
- `EditorView` -- renderer-owned portion of an editor observation.
- `EditorGlyph` -- active glyph occurrence using canonical domain identifiers.
- `ShiftSessionMode` -- alias of the canonical `FontSessionMode`, including memory hosts.

## How it works

A host implements `ShiftCapabilities` by routing each operation to the subsystem that owns the truth. The desktop host lists window/session identity in Electron main, captures pixels from the explicitly targeted window, and requests editor bounds or editor and font observations from that window's renderer.

Every targeted call returns `{ fontRevision, value }`. The renderer settles pending authored operations, checks an optional `ifFontRevision`, performs the read, and verifies that the same revision still owns the result. Accepted edits advance the session-local revision immediately; undo, redo, and failed-edit recovery advance it again; save does not. The token is opaque, non-orderable, scoped to one live renderer session, and invalid after renderer replacement. Shift retains no historical state for it. A mismatch fails explicitly so a caller can restart a composed read instead of combining revisions. Font revisions cover authored font truth, not viewport, selection, focus, or other editor-only state. A `captureId` identifies one image while its surrounding `fontRevision` correlates that image with font data.

Source-scoped glyph listings and layer reads use workspace glyph snapshots. `FontOverview.sources` lists global designspace sources, while `GlyphSummary.layers` advertises every global or glyph-specific authored layer as `{ layerId, sourceId }`. Supplying `sourceId` to `glyphs.list` adds each entry's nested `layer`, with `null` for sparse absence. `glyphs.get` accepts exactly one of a stable `glyphId` or an exact glyph `name` and uses the font directory's name index. `layers.get` returns directly navigable `contours[].points`, `components`, and `anchors`; components expose stable base identity and the conventional `xx`, `xy`, `yx`, `yy`, `dx`, `dy` transformation. Every advertised layer is readable and renderable by `sourceId`, even if it is not a global source.

`locations.resolve` accepts sparse external coordinates keyed by stable axis ID, fills omitted axes from defaults, maps them through the font's compiled axis mappings, identifies an exact source when present, and resolves source metrics. Duplicate or unknown axes fail explicitly. `glyphs.resolve` evaluates drawable glyph paths and advance widths at the same kind of arbitrary external location; known glyphs without drawable previews are reported in `unresolvedGlyphIds`.

Layer SVG rendering reads the root snapshot, then loads only its component closure so the shared editor render model applies the same recursive resolution and source fallback rules as the canvas. `layers.render` always includes the direct authored outline and recursively resolved component outlines. It can add source-addressable point, control-line, anchor, and direct-component overlays; labeled horizontal `fontMetrics`; and separate vertical `advanceWidth` guides. Optional `appearance` colors affect only SVG presentation, while structured `guides` expose source metrics and advance positions independently. Its SVG is a point-in-time proof rather than a live binding. `capture` similarly returns a uniquely identified PNG value: `window` captures the visible web contents, while `editor` crops to the renderer-reported canvas panel; optional `scale` resizes the output relative to logical UI pixels without changing editor state or inheriting the display's pixel density. Previews offer font and glyph directory facts, but no authored layer values. A missing layer in a known source returns `null`; unknown targets and preview-authored requests fail explicitly. Directory cursors are valid only while guarded by the same `fontRevision`. Other hosts may provide memory sessions while preserving the same capability shape.

The code-API generator bundles only declarations reachable from `capabilities.ts`, including the canonical branded identifiers from `@shift/types`, then adds the code-mode global `shift`. `@shift/mcp` imports that generated file as text for `shift.describe`; it does not maintain another declaration.

## Workflow recipes

### Add a capability

1. Reuse domain types from `@shift/types` or the package that canonically owns them.
2. Add the host-neutral operation and result to `src/capabilities.ts`.
3. Run `pnpm --filter @shift/runtime code-api:generate`.
4. Adapt the operation in each host and protocol boundary.
5. Add contract and host integration coverage.

### Verify generated declarations

```sh
pnpm --filter @shift/runtime code-api:check
```

`@shift/runtime` typechecking runs this check automatically.

## Gotchas

- The generated code API declares a global `shift`; the canonical runtime package does not pollute application globals.
- Branded identifiers serialize as strings but remain distinct types for TypeScript hosts.
- A capability interface describes authority, not ownership. Implementations must still route font truth, editor state, and persistence to their canonical subsystems.
- The established scripting vocabulary is a data-model convention, not a compatibility promise for FontParts' or Glyphs' mutable synchronous APIs. Shift keeps explicit windows, asynchronous operations, immutable observations, and stable IDs.
- Saved-file CLI adapters may reuse resolvers and output types, but live `windowId` and `fontRevision` semantics remain renderer-session concerns.

## Verification

```sh
pnpm --filter @shift/runtime code-api:check
pnpm --filter @shift/runtime typecheck
pnpm --filter @shift/runtime lint:check
pnpm typecheck
```

## Related

- [`packages/types/docs/DOCS.md`](../../types/docs/DOCS.md) -- canonical domain identities and snapshots.
- [`packages/sandbox/docs/DOCS.md`](../../sandbox/docs/DOCS.md) -- host-neutral code execution over these contracts.
- [`packages/mcp/docs/DOCS.md`](../../mcp/docs/DOCS.md) -- local MCP transport adapter.
- [`apps/desktop/src/main/docs/DOCS.md`](../../../apps/desktop/src/main/docs/DOCS.md) -- desktop capability routing and sandbox process ownership.

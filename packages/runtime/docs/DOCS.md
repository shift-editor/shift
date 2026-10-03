# @shift/runtime

<!-- reviewed: 2026-10-02 review-every: 90d -->

Host-neutral capability contracts shared by Shift protocol adapters and future plugin hosts.

## Architecture Invariants

- **Architecture Invariant:** `@shift/runtime` defines capability contracts only. It owns no Electron, MCP, renderer, utility-process, persistence, or sandbox implementation.
- **Architecture Invariant:** Existing domain identities and session modes come from `@shift/types`. Runtime contracts never redeclare `AxisId`, `GlyphId`, `NodeId`, `SourceId`, or `FontSessionMode` as parallel primitives.
- **Architecture Invariant:** `ShiftCapabilities` is the reusable platform surface. MCP, plugins, browser hosts, and tests adapt that contract without exposing internal `Editor`, `FontStore`, NAPI, IPC, or database objects.
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
- `EditorInspection` -- point-in-time editor observation paired with its explicit target.
- `FontOverview`, `GlyphPage`, `GlyphSummary`, and `LayerView` -- read-only font, paged directory, and source-specific authored geometry views.
- `shiftInputSchemas` -- reusable runtime validation of untrusted capability inputs before IPC.
- `EditorView` -- renderer-owned portion of an editor observation.
- `EditorGlyph` -- active glyph occurrence using canonical domain identifiers.
- `ShiftSessionMode` -- alias of the canonical `FontSessionMode`, including memory hosts.

## How it works

A host implements `ShiftCapabilities` by routing each operation to the subsystem that owns the truth. The desktop host lists window/session identity in Electron main and requests editor and font observations from the targeted renderer. Source-scoped glyph listings and layer reads use workspace glyph snapshots, not renderer editor-model loading. `FontOverview.sources` lists global masters; `GlyphSummary.sourceIds` also advertises glyph-specific support layers. `glyphs.get` accepts exactly one of a stable `glyphId` or an exact glyph `name` and uses the font directory's name index. Every advertised layer is readable by `sourceId`, even if it is not a global master. Previews offer font and glyph directory facts, but no authored layer views. A missing layer in a known source returns `null`; unknown targets and preview-authored requests fail explicitly. Directory pages carry an opaque cursor, not a frozen revision; consumers should restart a scan if the font changes between pages. Other hosts may provide memory sessions while preserving the same capability shape.

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

## Verification

```sh
pnpm --filter @shift/runtime code-api:check
pnpm --filter @shift/runtime typecheck
pnpm --filter @shift/runtime lint:check
pnpm typecheck
```

## Related

- [`packages/types/docs/DOCS.md`](../../types/docs/DOCS.md) -- canonical domain identities and snapshots.
- [`packages/mcp/docs/DOCS.md`](../../mcp/docs/DOCS.md) -- local MCP adapter and code-mode executor.
- [`apps/desktop/src/main/docs/DOCS.md`](../../../apps/desktop/src/main/docs/DOCS.md) -- desktop capability routing and sandbox process ownership.

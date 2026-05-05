# @shift/types

Shared DTO and primitive TypeScript types for Shift. This package owns branded IDs, math primitives, and bridge DTOs generated from `shift-bridge`.

## Architecture Invariants

- **Architecture Invariant: CRITICAL:** `src/bridge/generated.ts` is generated from `crates/shift-bridge/index.d.ts` by `scripts/generate-bridge-types.mjs`. Never edit it manually.
- **Architecture Invariant: CRITICAL:** `@shift/types` is the canonical TypeScript DTO facade for the native bridge. It strips `Napi*` prefixes and exports type-only DTOs.
- **Architecture Invariant:** Editor/domain snapshot types do not live here.
- **Architecture Invariant:** `PointId`, `ContourId`, and `AnchorId` are branded string types. TypeScript never generates IDs -- they originate from Rust. Use `asPointId()` / `asContourId()` / `asAnchorId()` to cast raw strings into branded types.
- **Architecture Invariant:** This package ships raw `.ts` source. `package.json` points `main` and `types` directly at `src/index.ts`.

## Codemap

```
packages/types/src/
  index.ts               -- root barrel: IDs, math, bridge DTOs
  math.ts                -- Point2D, Rect2D, TransformMatrix
  ids.ts                 -- branded IDs + cast helpers
  bridge/
    index.ts             -- stable bridge DTO barrel
    generated.ts         -- generated from shift-bridge/index.d.ts
```

## Bridge DTOs

Import from `@shift/types`.

- `BridgeApi` -- type-only native bridge API surface.
- `FontMetadata` / `FontMetrics` -- font-level DTOs returned by `Bridge`.
- `GlyphRecord` -- committed glyph list record: name, unicodes, component base names.
- `GlyphStructure` -- stable glyph structure: contours, anchors, components.
- `GlyphStructureChange` -- structural edit result: new structure, `Float64Array` values, changed IDs.
- `GlyphValueChange` -- hot-path value edit result: `Float64Array` values, changed IDs.
- `PointType` -- bridge point type union.

## Generation

`shift-bridge` owns the low-level NAPI declaration file at `crates/shift-bridge/index.d.ts`. `scripts/generate-bridge-types.mjs` reads that declaration file and emits `src/bridge/generated.ts`.

The generator:

- removes the runtime `Bridge` class and emits a type-only `BridgeApi`;
- strips `Napi` prefixes from exported DTO names;
- preserves branded ID imports from `../ids`;
- preserves typed arrays such as `Float64Array` and `BigUint64Array`.

Turbo owns the cache key:

```text
task:
  generate:bridge-types

inputs:
  crates/shift-bridge/index.d.ts
  scripts/generate-bridge-types.mjs

output:
  packages/types/src/bridge/generated.ts
```

Run:

```bash
pnpm generate:bridge-types
```

`turbo run typecheck` depends on `generate:bridge-types`, so stale bridge declarations are refreshed before typecheck when inputs change.

## Workflow Recipes

### Regenerate bridge types after Rust bridge changes

1. Update `shift-wire` and/or `shift-wire::bridges::napi`.
2. Rebuild `shift-bridge` declarations.
3. Run `pnpm generate:bridge-types`.
4. Import the result from `@shift/types`.
5. Run `pnpm typecheck`.

### Add a new branded ID type

1. Add the brand symbol, branded type, cast function, and type guard to `ids.ts`.
2. Export from `index.ts`.
3. If bridge declarations reference the new ID, make sure `crates/shift-bridge/dts-header.d.ts` imports it from `@shift/types`.

## Gotchas

- **Stale bridge DTOs:** Run `pnpm generate:bridge-types` after rebuilding `shift-bridge/index.d.ts`. Turbo caches this based on the declaration input and generator script.
- **No editor/domain types:** If renderer code needs editor-owned shapes, define them in the app or the relevant editor package. Do not add snapshot-era types back here.
- **No build step:** This package has no compilation. If you add non-TS files or try to emit `.d.ts`, the current setup will not support it.

## Verification

- `pnpm generate:bridge-types` -- regenerates the bridge DTO facade.
- `pnpm --filter @shift/types typecheck` -- verifies package types.
- `pnpm typecheck` -- verifies the workspace after generation.

## Related

- `shift-wire` -- Rust source of truth for bridge DTO semantics.
- `shift-bridge` -- NAPI bridge class and generated declaration source.
- `scripts/generate-bridge-types.mjs` -- declaration transformer for the generated bridge DTO internals.
- `@shift/bridge` -- runtime package that creates the native bridge instance.

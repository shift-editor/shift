# shift-wasm

<!-- reviewed: 2026-10-17 review-every: 90d -->

Runs shift-font's rules in the editor through WebAssembly, so the editor calls the same Rust the workspace and export use instead of a TypeScript copy. `crates/shift-wasm` is the Rust side; `packages/wasm` (`@shift/wasm`) builds it and ships the module to TypeScript.

## Architecture Invariants

- **One implementation.** Each export calls shift-font code that native callers also use: anchor kinds from fontir's `AnchorKind::new`, `anchor_propagation::compiled_anchors`, `anchor_attachment::follow_anchors`, and the variation evaluators (`AxisMappingBasis::evaluate`, `map_location_with_bases`, `InterpolationBasis::weights_at`). This crate only converts between numbers and those types. A rule that needs logic here is a rule that belongs in shift-font.
- **Synchronous.** The module is embedded in `@shift/wasm` as base64 and instantiated with `initSync` at import, so computeds and render paths call it directly. Nothing awaits, fetches, or needs a bundler plugin; desktop, vitest, and the SDK import it the same way.
- **The committed module is the build.** `packages/wasm/src/generated/` is checked in and must equal a fresh build. CI's `wasm` job rebuilds it with `--check` and fails on any difference. Change this crate, or the shift-font code it calls, and you rebuild and commit the output.
- **Reproducible bytes.** The build remaps the checkout and Cargo home paths that panic messages embed, pins wasm-bindgen exactly (`=0.2.121`, matched against `Cargo.lock` by the build script), and runs one wasm-opt (binaryen 132) with explicit features. Different machines produce identical output.
- **Numbers across the boundary.** Hot calls take and return `Float64Array`s in the layouts each function documents, with no per-call objects. Anchor names are interned once (`internName`/`nameOf`) and travel as ids. Axes and compiled bases are registered once, giving a handle; a location then travels as numbers in axis order, NaN for a missing coordinate. Cold, structured values (`AnchorKind`, registration inputs) are typed with tsify, so `shift_wasm.d.ts` is generated, not hand-written.
- **Handles follow their objects.** The editor registers each axes array and basis once per object identity (`lib/wasm/variation.ts`, `Handles`). A `FinalizationRegistry` releases the module's copy when the object is collected.

## Codemap

```text
crates/shift-wasm/src/
  lib.rs         module list
  anchors.rs     anchorKind, propagateAnchors, followAnchors
  variation.rs   axis and basis registries, interpolationWeights, mapAxisLocation, evaluateAxisMapping, denormalizeAxis
  names.rs       interned anchor names
  reader.rs      sequential reader over a Float64Array input
packages/wasm/
  scripts/build.mjs   cargo build → wasm-bindgen → wasm-opt → base64 module.ts; --check diffs a fresh build
  src/index.ts        instantiates the module and re-exports the glue
  src/generated/      committed build output (glue, types, base64 module)
packages/editor/src/lib/wasm/
  anchors.ts     typed wrappers: propagateAnchors, followingPlacements, anchorKind
  variation.ts   typed wrappers, handles, and the per-basis weights memo
  names.ts       name-id cache
```

## Building

The Nix dev shell provides `wasm-bindgen-cli` and `binaryen`.

```bash
nix develop --command pnpm --filter @shift/wasm build:wasm   # rebuild src/generated
nix develop --command pnpm --filter @shift/wasm check:wasm   # fail if src/generated is stale
```

Updating wasm-bindgen means changing the crate pin, the Nix package, and `Cargo.lock` together; the build script refuses a CLI that does not match the lockfile, and CI installs the version the lockfile names.

## What stays in TypeScript

- **Blending** (`interpolateSourceValues`) runs over the live coordinate buffers every frame; it multiplies by weights and has no rule to drift.
- **Kerning precedence** (`Kerning.resolve`) resolves against the per-frame pending-edit overlay, and syncing that overlay into the module would cost more than the rule. A fixture Rust writes (`packages/types/__fixtures__/kerning_resolution.json`, from shift-wire's `kerning_resolution_fixture_matches_rust`) checks it instead.
- **The inverse axis mapping** (`unmapAxisMappings`) searches over the forward mapping, which itself runs here.

## Adding a rule

1. Make the rule a plain-data function in shift-font that native callers use too.
2. Export it here, taking numbers for anything called per frame and tsify types otherwise.
3. Add a typed wrapper in `packages/editor/src/lib/wasm/` and delete the TypeScript copy and its oracle.
4. Rebuild with `build:wasm` and commit `packages/wasm/src/generated/`.

# shift-wasm

<!-- reviewed: 2026-10-17 review-every: 90d -->

Runs shift-font's rules in the editor through WebAssembly, so the editor calls the same Rust the workspace and export use instead of a TypeScript copy. `crates/shift-wasm` is the Rust side; `packages/wasm` (`@shift/wasm`) builds it and ships the module to TypeScript.

## Architecture Invariants

- **One implementation.** Each export calls shift-font code that native callers also use: anchor kinds from fontir's `AnchorKind::new`, `anchor_propagation::compiled_anchors`, `anchor_attachment::follow_anchors`, and the variation evaluators (`AxisMappingBasis::evaluate`, `map_location_with_bases`, `InterpolationBasis::weights_at`). This crate only converts between numbers and those types. A rule that needs logic here is a rule that belongs in shift-font.
- **Synchronous.** The module is embedded in `@shift/wasm` as base64 and instantiated with `initSync` at import, so computeds and render paths call it directly. Nothing awaits, fetches, or needs a bundler plugin; desktop, vitest, and the SDK import it the same way.
- **Built, never committed.** `packages/wasm/src/generated/` is gitignored and built like the native addon: `@shift/wasm#build` is a turbo task over the Rust sources, `build:native` runs it, and typecheck, tests, and desktop builds depend on it. WHY: rustc's output depends on the build host (Cargo hashes `rustc -vV`, host line included, into symbol names, which decides data layout), so a module built on macOS never matches one built on Linux, and a committed copy could not be checked against a fresh build.
- **Pinned toolchain.** wasm-bindgen is pinned exactly (`=0.2.121`); the build script refuses a CLI that does not match `Cargo.lock`. wasm-opt is binaryen 132 with explicit features. The checkout and Cargo home paths that panic messages embed are remapped, so the module carries no machine's paths.
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
  scripts/build.mjs   cargo build → wasm-bindgen → wasm-opt → base64 module.ts in src/generated (gitignored)
  src/index.ts        instantiates the module and re-exports the glue
.github/actions/wasm-toolchain/
  action.yml          installs the pinned wasm-bindgen and wasm-opt on any CI runner
packages/editor/src/lib/wasm/
  anchors.ts     typed wrappers: propagateAnchors, followingPlacements, anchorKind
  variation.ts   typed wrappers, handles, and the per-basis weights memo
  names.ts       name-id cache
```

## Key Types

- **`AnchorKind`** — an anchor's role read from its name, as a tsify-typed tagged union.
- **Registries** (`registerAxes`, `registerVariationBasis`, `registerInterpolationBasis`, `registerAxisMappings`) — hold Rust copies of the editor's compiled values, addressed by handle; the editor's `Handles` maps each object to its handle.
- **Number layouts** — `propagateAnchors` and `followAnchors` take and return flat `Float64Array`s laid out as their doc comments describe; locations are numbers in registered-axis order.

## How it works

`build.mjs` builds the crate for `wasm32-unknown-unknown`, runs wasm-bindgen for the web target, shrinks the module with wasm-opt, and writes it as base64 into `module.ts`, dropping the glue's fetch-by-URL fallback so bundlers emit no stray copy. `src/index.ts` decodes it and calls `initSync` at import. The editor's wrappers in `lib/wasm/` intern names, register axes and bases once, pack inputs into typed arrays, and unpack results; they hold no rules of their own.

The Nix dev shell provides `wasm-bindgen-cli` and `binaryen`; CI jobs install the same versions with `.github/actions/wasm-toolchain`. Updating wasm-bindgen means changing the crate pin, the Nix package, and `Cargo.lock` together.

## What stays in TypeScript

- **Blending** (`interpolateSourceValues`) runs over the live coordinate buffers every frame; it multiplies by weights and has no rule to drift.
- **Kerning precedence** (`Kerning.resolve`) resolves against the per-frame pending-edit overlay, and syncing that overlay into the module would cost more than the rule. A fixture Rust writes (`packages/types/__fixtures__/kerning_resolution.json`, from shift-wire's `kerning_resolution_fixture_matches_rust`) checks it instead.
- **The inverse axis mapping** (`unmapAxisMappings`) searches over the forward mapping, which itself runs here.

## Workflow recipes

### Adding a rule

1. Make the rule a plain-data function in shift-font that native callers use too.
2. Export it here, taking numbers for anything called per frame and tsify types otherwise.
3. Add a typed wrapper in `packages/editor/src/lib/wasm/` and delete the TypeScript copy and its oracle.
4. Run `pnpm build:wasm` (turbo rebuilds it on its own before typecheck and tests).

## Gotchas

- **Running vitest directly skips the build.** Running vitest from a package directory or an editor test runner does not go through turbo, so after changing shift-font or this crate the module is stale until `pnpm build:wasm` runs. The root `pnpm test`, `pnpm test:desktop`, and `pnpm check` rebuild it.
- **A missing module fails at import.** A fresh clone has no `src/generated/`; anything importing `@shift/wasm` fails to resolve it until the first build.

## Verification

```bash
nix develop --command pnpm build:wasm                # build packages/wasm/src/generated
nix develop --command pnpm check                     # typecheck and tests build it first
nix develop --command cargo clippy -p shift-wasm --target wasm32-unknown-unknown -- -D warnings
```

## Related

- [`crates/shift-font/docs/DOCS.md`](../../shift-font/docs/DOCS.md) — the rules this crate exports.
- [`packages/editor/src/lib/model/docs/DOCS.md`](../../../packages/editor/src/lib/model/docs/DOCS.md) — where the editor calls them.

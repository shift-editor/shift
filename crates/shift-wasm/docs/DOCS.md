# shift-wasm

<!-- reviewed: 2026-10-18 review-every: 90d -->

Runs shift-font's rules in the editor through WebAssembly, so the editor calls the same Rust the workspace and export use instead of a TypeScript copy. `crates/shift-wasm` is the Rust side; `packages/wasm` (`@shift/wasm`) builds it and ships the module to TypeScript.

## Architecture Invariants

- **One implementation.** Each export calls shift-font code that native callers also use: anchor kinds from fontir's `AnchorKind::new`, `anchor_propagation::compiled_anchors`, `anchor_attachment::follow_anchors`, and the variation evaluators (`AxisMappingBasis::evaluate`, `map_location_with_bases`, `InterpolationBasis::weights_at`). This crate only converts between numbers and those types. A rule that needs logic here is a rule that belongs in shift-font.
- **Synchronous.** The module is embedded in `@shift/wasm` as base64 and instantiated with `initSync` at import, so computeds and render paths call it directly. Nothing awaits, fetches, or needs a bundler plugin; desktop, vitest, and the SDK import it the same way.
- **Built, never committed.** `packages/wasm/src/generated/` and `src/generated-reference/` are gitignored and built like the native addon: `@shift/wasm#build` is a turbo task over the Rust sources, `build:native` runs it, and typecheck, tests, and desktop builds depend on it. WHY: rustc's output depends on the build host (Cargo hashes `rustc -vV`, host line included, into symbol names, which decides data layout), so a module built on macOS never matches one built on Linux, and a committed copy could not be checked against a fresh build.
- **Pinned toolchain.** wasm-bindgen is pinned exactly (`=0.2.121`); the build script refuses a CLI that does not match `Cargo.lock`. wasm-opt is the npm `binaryen` package, pinned exactly as a devDependency of `@shift/wasm` and run through Node from the package's own `bin`, never from PATH, with explicit features. The checkout and Cargo home paths that panic messages embed are remapped, so the module carries no machine's paths.
- **Numbers across the boundary.** Hot calls take and return `Float64Array`s, with no per-call objects. **CRITICAL**: each layout is declared once, in Rust (`layout!`, `foreign_layout!`, `enum_layout!` in `src/layout.rs`), and the editor's side of every hot call — interfaces, encoder, the call, decoder — is generated from it into `packages/editor/src/lib/wasm/generated/layouts.ts` by the `generated_file_wasm_layouts` test. Never hand-write a packer: a field order typed out twice drifts silently, because reading past the end yields zeros rather than an error. Anchor names are interned once (`internName`/`nameOf`) and travel as ids. Axes and compiled bases are registered once, giving a handle; a location then travels as numbers in axis order, NaN for a missing coordinate. Cold, structured values (`AnchorKind`, registration inputs) are typed with tsify, so `shift_wasm.d.ts` is generated, not hand-written.
- **The reference module never ships.** The `reference` cargo feature adds test-only exports (`src/reference/`) that return shift-font's answers for the rules the editor keeps in TypeScript. It builds into a second module, `src/generated-reference/`, loaded by `@shift/wasm/reference`. The production module is built without the feature and is unchanged by it. Lint (`shift/no-reference-module-outside-tests`) rejects importing it outside `.test.ts` files and `testing/` helpers, and the SDK build fails if its bundle contains it.
- **Handles follow their objects.** The editor registers each axes array and basis once per object identity (`lib/wasm/variation.ts`, `Handles`). A `FinalizationRegistry` releases the module's copy when the object is collected.

## Codemap

```text
crates/shift-wasm/src/
  lib.rs         module list
  anchors.rs     anchorKind, propagateAnchors, followAnchors
  decomposition.rs   blendDecomposedGlyph: component outlines between masters of a decomposed glyph
  variation.rs   axis and basis registries, interpolationWeights, mapAxisLocation, evaluateAxisMapping, denormalizeAxis
  names.rs       interned anchor names
  layout.rs      Reader, Writer, the Layout trait, and the layout! macros hot calls are declared with
  layout/typescript.rs   generated_file_wasm_layouts: the registry of hot calls and the TypeScript generator
  reference/     test-only exports behind the `reference` feature
    geometry.rs      composeTransform, transformPoint, decomposeMatrix, contourGeometry, transformLayer
    kerning.rs       resolveKerning
    axis_mapping.rs  compileAxisMappings, mapLocation
packages/wasm/
  scripts/build.mjs   cargo build → wasm-bindgen → wasm-opt (npm binaryen) → base64 module.ts, for both modules into src/generated and src/generated-reference (gitignored)
  src/index.ts        instantiates the module and re-exports the glue
  src/reference.ts    @shift/wasm/reference: instantiates the reference module, for tests only
  src/embedded.ts     compiles a base64-embedded module synchronously
.github/actions/wasm-toolchain/
  action.yml          installs the pinned wasm-bindgen on any CI runner
packages/editor/src/testing/
  reference.ts   @shift/editor/reference-testing: generated inputs and comparisons shared by the reference tests
packages/editor/src/lib/reference/
  Component.reference.test.ts, Contour.reference.test.ts   glyph-state and geo geometry against Rust
packages/editor/src/lib/wasm/
  generated/layouts.ts   generated: interfaces and typed calls for every hot call (oxfmt-ignored)
  numbers.ts     NumberWriter (one shared, growing buffer) and NumberReader, used by the generated calls
  anchors.ts     propagateAnchors, followingPlacements, anchorKind over the generated calls
  variation.ts   typed wrappers, handles, and the per-basis weights memo
  names.ts       name-id cache
```

## Key Types

- **`AnchorKind`** — an anchor's role read from its name, as a tsify-typed tagged union.
- **Registries** (`registerAxes`, `registerVariationBasis`, `registerInterpolationBasis`, `registerAxisMappings`) — hold Rust copies of the editor's compiled values, addressed by handle; the editor's `Handles` maps each object to its handle.
- **`Layout`** — a value with a number layout: `read`, `write`, and (in tests) `kind`, the description the TypeScript generator reads. Fields cross in declaration order; a list is its length then its items, an optional value a flag then the value, a name its interned id, an enum its variant index (a string in TypeScript). Locations are not layouts: they are plain numbers in registered-axis order.
- **`@shift/wasm/reference`** — the test-only module's comparison exports: `composeTransform`, `transformPoint`, `decomposeMatrix`, `contourGeometry`, `transformLayer`, `resolveKerning`, `compileAxisMappings`, `mapLocation`. Their `Reference*` input and output types are generated by tsify and mirror only the fields Rust reads, so the editor's `DecomposedTransform`, `MatModel`, `GlyphState`, `KerningSnapshot`, `KerningValueEdit`, `Axis`, and `AxisMapping` satisfy them. A value Rust has no answer for (no bounds, no kerning pair) comes back `undefined`.

## How it works

### Building

`build.mjs` builds the crate for `wasm32-unknown-unknown` twice: without features into `src/generated/`, and with `--features reference` into `src/generated-reference/`. Each build runs wasm-bindgen for the web target, shrinks the module with wasm-opt, and writes it as base64 into `module.ts`, dropping the glue's fetch-by-URL fallback so bundlers emit no stray copy. `src/index.ts` and `src/reference.ts` decode their module and call `initSync` at import. The production bytes do not depend on the reference build. The editor's wrappers in `lib/wasm/` intern names, register axes and bases once, pack inputs into typed arrays, and unpack results; they hold no rules of their own.

Every `@shift/wasm` build task (`build`, `build:debug`, `build:e2e`) runs the script, and its turbo outputs cover both folders, so a cached build restores the reference module too and a reference test needs no step of its own.

The Nix dev shell provides `wasm-bindgen-cli`; CI jobs install the version `Cargo.lock` pins with `.github/actions/wasm-toolchain` (`taiki-e/install-action`). Updating wasm-bindgen means changing the crate pin, the Nix package, and `Cargo.lock` together. wasm-opt needs no install: `pnpm install` brings it with `@shift/wasm`'s `binaryen` devDependency, so updating it is a `package.json` change.

### Choosing a route

Rust owns every rule the font compiler or format decides, and the editor and export must agree on it. When the editor needs one synchronously, ask: if the Rust changed tomorrow, would the TypeScript disagree with export without anything failing?

- **A rule goes through this module.** Ordering, reversal, structure matching, precedence, model construction: anything a compiler decides. It is a plain-data function in shift-font that native projection calls too, exported here and called through a wrapper. There is no TypeScript copy, not even as a fallback for when the module is missing. A function that returns "no answer" (structures that don't match, a location outside the model) lets the caller fall back to a different rule's output, never to a TypeScript version of the same rule.
- **Arithmetic with no decision in it may stay in TypeScript.** Weighted sums, matrix application, and bounds over live buffers have nothing that can drift beyond float rounding. Each one still gets a `*.reference.test.ts` against the Rust.
- **A rule stays in TypeScript only when measured.** On a per-frame path, calling here costs packing, copying in and out, and unpacking. A rule that stays in TypeScript for that reason needs a measurement of both paths on the same workload, boundary packing included, and a reference test, and gets a line under "What stays in TypeScript" giving the reason. A guess that the boundary is too slow is not a reason; at tens of points a call can cost less than the objects the TypeScript allocates.
- **Split mixed code at the rule.** When one function both decides (which points pair up) and computes (their weighted sum), the deciding part comes here even if the arithmetic stays in TypeScript.
- **One side owns each piece of data.** A number layout is documented once, on the Rust export, and the editor's wrapper packs and unpacks it with no logic of its own. Identity (contour and point ids, output order) is decided on one side, and the export's doc comment says which. Rust returns numbers in a stated order, and the wrapper attaches the ids that order implies.

### What stays in TypeScript

- **Blending** (`interpolateSourceValues`) runs over the live coordinate buffers every frame; it multiplies by weights and has no rule to drift.
- **Kerning precedence** (`Kerning.resolve`) resolves against the per-frame pending-edit overlay, and syncing that overlay into the module would cost more than the rule. `Kerning.reference.test.ts` checks it against `Kerning::resolve`, with and without pending edits.
- **Per-frame geometry**: component matrix compose and decompose (`Mat`), segment parsing and bounds (`Contour`, `Segment`), and whole-layer transforms (`LayerBuffers.transformLayer`) run on every drag frame over the live buffers. `Component.reference.test.ts`, `Contour.reference.test.ts`, and `LayerBuffers.reference.test.ts` check them against `DecomposedTransform`, `CurveSegmentIter` with `segment_bounds`, and `GlyphLayer::transform_layer`.
- **The inverse axis mapping** (`unmapAxisMappings`) searches over the forward mapping, which itself runs here.

### Reference tests

A rule that stays in TypeScript is tested against the Rust directly, not against a fixture Rust writes: the test builds its inputs in code, runs the TypeScript and the matching `@shift/wasm/reference` export on each, and compares. Nothing can go stale, and a failure names the input.

Inputs come from `@shift/editor/reference-testing`: every on/off-curve pattern up to four points, open and closed (the parser looks three points ahead), curated curves such as truncated cubic tails, named and collapsed transforms, and seeded sweeps (`seededRandom`, fixed seeds, a few hundred cases each). `expectNumbersClose` and its matrix, decomposed, and bounds variants compare to 9 decimal digits (the two sides run the same float operations, so they agree to about 1e-12) and compare rotations by angle difference, since 180° and -180° are the same rotation. Axis mapping (`location.test.ts`) compiles its mappings through `compileAxisMappings`, as the bridge would send them, and compares `mapAxisLocation` with `mapLocation` over a sweep of locations.

The reference module never ships. It is a second instance with its own memory, about 2.5 times the size of the editor's module (it carries the axis-mapping compiler and kerning model), and its exports would invite calling Rust for rules the editor deliberately runs in TypeScript.

## Workflow recipes

### Adding a rule

1. Make the rule a plain-data function in shift-font that native callers use too.
2. For a call made per frame, declare its input and output here with `layout!` (a struct this crate owns), `foreign_layout!` (a shift-font struct, listing the fields that cross), or `enum_layout!`, and export `fn(input: &[f64]) -> Vec<f64>` as `call(input, |value: Input| rule(...))`. Cold calls take tsify types instead.
3. Register the call in `calls()` in `src/layout/typescript.rs` and run `pnpm generate:from-rust`, which writes its typed function into `generated/layouts.ts`.
4. Wrap that function in `packages/editor/src/lib/wasm/` only where the editor needs a different shape (`followingPlacements` turns decomposed transforms into matrices), and delete the TypeScript copy and its oracle.
5. Run `pnpm build:wasm` (turbo rebuilds it on its own before typecheck and tests).

### Adding a comparison

1. Add an export to `src/reference/` that converts its input to shift-font types, calls the function native callers use, and converts the result back. It must have no logic of its own. Type inputs and outputs with tsify; mirror only the fields Rust reads, so the editor's own types satisfy them.
2. Re-export it from `packages/wasm/src/reference.ts` and run `pnpm build:wasm`. Only the sources are committed.
3. Write a `*.reference.test.ts` beside the TypeScript it checks, generating inputs with the shared helpers in `@shift/editor/reference-testing`. The package's `test` task must depend on `@shift/wasm#build` in `turbo.json` so the module exists when it runs.

## Gotchas

- **Running vitest directly skips the build.** Running vitest from a package directory or an editor test runner does not go through turbo, so after changing shift-font or this crate both modules are stale until `pnpm build:wasm` runs. The root `pnpm test`, `pnpm test:desktop`, and `pnpm check` rebuild them.
- **A missing module fails at import.** A fresh clone has no `src/generated/` or `src/generated-reference/`; anything importing `@shift/wasm` or `@shift/wasm/reference` fails to resolve it until the first build.
- **A stale generated file fails `cargo test`, not typecheck.** Changing a layout without `pnpm generate:from-rust` still typechecks against the old `layouts.ts`; `generated_file_wasm_layouts` is what catches it.
- **The layout description is test-only.** `Kind` and `Layout::kind` exist under `cfg(test)`, so the shipped module carries no schema; the generator runs as a host `cargo test`.
- **The workspace clippy run skips the reference exports.** `cargo clippy --workspace` builds without features, so CI's `rust-check` job lints `--features reference` for wasm32 in its own step.

## Verification

```bash
nix develop --command cargo test -p shift-wasm --lib  # layout round trips; fails when generated/layouts.ts is stale
nix develop --command pnpm build:wasm                # build src/generated and src/generated-reference
nix develop --command pnpm check                     # typecheck and tests build both first
nix develop --command cargo clippy -p shift-wasm --target wasm32-unknown-unknown -- -D warnings
nix develop --command cargo clippy -p shift-wasm --features reference --target wasm32-unknown-unknown -- -D warnings
```

## Related

- [`crates/shift-font/docs/DOCS.md`](../../shift-font/docs/DOCS.md) — the rules every export calls.
- [`packages/editor/src/lib/model/docs/DOCS.md`](../../../packages/editor/src/lib/model/docs/DOCS.md) — where the editor calls them: `Kerning`, axis mapping, and interpolation.
- [`packages/glyph-state/docs/DOCS.md`](../../../packages/glyph-state/docs/DOCS.md) — contour and segment geometry the reference tests check.

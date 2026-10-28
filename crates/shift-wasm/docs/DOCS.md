# shift-wasm

<!-- reviewed: 2026-10-25 review-every: 90d -->

Runs shift-font's rules in the editor through WebAssembly, so the editor calls the same Rust the workspace and export use instead of a TypeScript copy. `crates/shift-wasm` is the Rust side; `packages/wasm` (`@shift/wasm`) builds it and ships the module to TypeScript.

## Architecture Invariants

- **One implementation.** Each export calls shift-font code that native callers also use: anchor kinds from fontir's `AnchorKind::new`, `anchor_propagation::compiled_anchors`, `anchor_attachment::follow_anchors`, and the variation evaluators (`AxisMappingBasis::evaluate`, `map_location_with_bases`, `InterpolationBasis::weights_at`). This crate only converts between numbers and those types. A rule that needs logic here is a rule that belongs in shift-font.
- **Synchronous.** The module is embedded in `@shift/wasm` as base64 and instantiated with `initSync` at import, so computeds and render paths call it directly. Nothing awaits, fetches, or needs a bundler plugin; desktop, vitest, and the SDK import it the same way. The engine is the exception: `@shift/wasm/engine` ships `shift_wasm_bg.wasm` as a file and compiles it during its (dynamic) import, fetched in the renderer and read from disk under Node; calls after the import are synchronous. **WHY:** decoding its 3.8 MB of base64 cost about 60 MB under Node and compiled on the main thread.
- **Built, never committed.** `packages/wasm/src/generated/`, `src/generated-reference/`, `src/generated-shaping/`, and `src/generated-engine/` are gitignored and built like the native addon: `@shift/wasm#build` is a turbo task over the Rust sources that builds the three modules the app loads; `build:native` runs it, and tests and desktop builds depend on it. Tests also depend on `@shift/wasm#build:reference`, which builds only the reference module. Typecheck depends on `@shift/wasm#types` instead (`build.mjs --types`), which writes only each variant's `shift_wasm.d.ts` and `module.d.ts` from a debug build without wasm-opt. The release build writes the same declarations; `InitOutput` is sorted in both, because its members follow the module's export order, which differs between debug and release. WHY: rustc's output depends on the build host (Cargo hashes `rustc -vV`, host line included, into symbol names, which decides data layout), so a module built on macOS never matches one built on Linux, and a committed copy could not be checked against a fresh build.
- **Pinned toolchain.** wasm-bindgen is pinned exactly (`=0.2.121`); the build script refuses a CLI that does not match `Cargo.lock`. wasm-opt is the npm `binaryen` package, pinned exactly as a devDependency of `@shift/wasm` and run through Node from the package's own `bin`, never from PATH, with explicit features. It only shrinks the module, so it runs only with `SHIFT_WASM_OPT=1`, which the Nightly, release and perf workflows and `pnpm profile:build` set; local builds and CI tests skip it, about 20 s per build. The Cargo home path that panic messages embed is remapped, so the module carries no machine's paths. Cargo passes workspace crates as paths relative to the checkout, so the checkout is not remapped, which keeps RUSTFLAGS, and so every crate's fingerprint, the same in every checkout.
- **Numbers across the boundary.** Hot calls take and return `Float64Array`s, with no per-call objects. **CRITICAL**: each layout is declared once, in Rust (`layout!`, `foreign_layout!`, `enum_layout!` in `src/layout.rs`), and the editor's side of every hot call — interfaces, encoder, the call, decoder — is generated from it into `packages/editor/src/lib/wasm/generated/layouts.ts` (and glyph-state's `src/generated/geometryLayouts.ts` for `contourGeometry`) by the `generated_file_wasm_layouts` test. Never hand-write a packer: a field order typed out twice drifts silently, because reading past the end yields zeros rather than an error. Anchor names are interned once (`internName`/`nameOf`) and travel as ids. Axes and compiled bases are registered once, giving a handle; a location then travels as numbers in axis order, NaN for a missing coordinate. Cold, structured values (`AnchorKind`, registration inputs) are typed with tsify, so `shift_wasm.d.ts` is generated, not hand-written.
- **Shaping is a module of its own, loaded on demand.** The `shaping` feature builds shift-shape and HarfRust into `src/generated-shaping/`, loaded by `@shift/wasm/shaping`, several times the size of the production module. The editor imports it dynamically (`lib/wasm/shaping.ts`, `loadShaping`) so bundlers split it into a chunk that loads when text is first laid out. It is a separate instance with its own memory and name table, so its layouts carry no interned names: units, locations, and tags cross as numbers. Each module's generated calls go to their own file (`generated/layouts.ts`, `generated/shapingLayouts.ts`), importing only that module.
- **The editing engine is a module of its own, loaded when a font opens for editing.** The `engine` feature builds shift-engine's `EngineSession` into `src/generated-engine/`, loaded by `@shift/wasm/engine` and wrapped by the editor's `lib/wasm/engine.ts` (`loadEngine`, `EngineSession`). It is the same session the native workspace runs. Intents cross as `shift_wire::intents::FontIntent` values through serde, the shape the workspace takes; touched layers come back as values, with their structure only when the edit changed it (`EngineLayer.structure` is null otherwise), and then with each contour the edit kept sent by id alone (`KeptContour`), read against the structure the edit started from. **WHY:** building a 50,000-point glyph's structure as objects cost more than the edit; a nudge of all its points took 51.6 ms, and an added point 38 ms in the editor. A `setPositions` intent skips serde: its positions cross as one copied `Float64Array` (7.0 to 0.8 ms for 50,000 points). The change set an edit returns for persisting is compacted (`FontChangeSet::compact`): a layer change that only moved values carries the values, not the layer twice (7.8 to 1.9 ms to encode, 7 MB to 1.8 MB), and the workspace rebuilds it against its own layer (`FontWorkspace::persist_compact_change_set`). Layers load through an `EngineLayerSource` the editor passes in, whose TypeScript interface is declared once in `engine.rs` (`typescript_custom_section`), so the Rust trait and the JavaScript object cannot drift. The source must not call back into the engine. A gesture keeps one edit open across frames: `engineRewindEdit` puts the session back where the edit began, and `engineStage` applies the frame's intents without building font-level records, which are built once, by `engineApply`, when it commits.
- **The editor reads the font from the engine, in flat hot calls.** `engine_reads.rs` answers kerning (`engineKerningRun` for a whole run of pairs, `engineKerningPairs` for which authored pair applies or an edit changes) and source metrics between masters (`engineSourceMetricsAt`) from the session's font, an open edit included. Two cold kerning reads return tsify values instead: the pairs at a source that name a glyph (`engineKerningPairsNaming`) and where a missing pair's value comes from (`engineMissingKerningOrigin`). Its layouts are declared outside the `engine` feature, like shaping's, and generate `generated/engineLayouts.ts`. The engine has no name table, so ids cross as numbers the session interns once each (`engineGlyphNumbers`, `engineSourceNumbers`), and the editor's `EngineSession` caches them.
- **The reference module never ships.** The `reference` cargo feature adds test-only exports (`src/reference/`) that return shift-font's answers for the rules the editor keeps in TypeScript. It builds into a second module, `src/generated-reference/`, loaded by `@shift/wasm/reference`. The production module is built without the feature and is unchanged by it. Lint (`shift/no-reference-module-outside-tests`) rejects importing it outside `.test.ts` files and `testing/` helpers, and the SDK build fails if its bundle contains it.
- **Handles follow their objects.** The editor registers each axes array and basis once per object identity (`lib/wasm/variation.ts`, `Handles`). A `FinalizationRegistry` releases the module's copy when the object is collected.

## Codemap

```text
crates/shift-wasm/src/
  lib.rs         module list
  anchors.rs     anchorKind, propagateAnchors, followAnchors
  decomposition.rs   blendDecomposedGlyph: component outlines between masters of a decomposed glyph
  drag.rs        prepareDrag, dragMoves, releaseDrag: shift-font's drag rules, matched once per drag behind a handle, one call per frame
  shaping.rs     registerShaper, setShaperGlyphs, shapeParagraphs (the `shaping` feature)
  engine.rs      engineOpen, engineBeginEdit, engineApply, engineRewindEdit, engineStage, engineEndEdit, engineCancelEdit, engineUndo, engineRedo, enginePreview, enginePreload, engineRelease, EngineLayerSource (the `engine` feature)
  engine_reads.rs   engineGlyphNumbers, engineSourceNumbers, engineKerningRun, engineKerningPairs, engineKerningPairsNaming, engineMissingKerningOrigin, engineSourceMetricsAt, and their layouts
  geometry.rs    contourGeometry (a contour's segments and bounds), composeTransform and decomposeMatrix (component placements), generated into glyph-state
  variation.rs   axis and basis registries, interpolationWeights, mapAxisLocation, unmapAxisLocation
  names.rs       interned anchor names
  layout.rs      Reader, Writer, the Layout trait, and the layout! macros hot calls are declared with
  layout/typescript.rs   generated_file_wasm_layouts: the registry of hot calls and the TypeScript generator
  reference/     test-only exports behind the `reference` feature
    axis_mapping.rs  compileAxisMappings, mapLocation
packages/wasm/
  scripts/build.mjs   cargo build → wasm-bindgen → wasm-opt (npm binaryen, only with SHIFT_WASM_OPT=1) → base64 module.ts (shift_wasm_bg.wasm for the engine), into src/generated, src/generated-shaping and src/generated-engine, or src/generated-reference with --reference (gitignored)
  src/index.ts        instantiates the module and re-exports the glue
  src/reference.ts    @shift/wasm/reference: instantiates the reference module, for tests only
  src/embedded.ts     compiles a base64-embedded module synchronously
  src/numbers.ts      @shift/wasm/numbers: NumberWriter (one shared, growing buffer) and NumberReader, used by every generated call
  src/names.ts        name-id cache the readers and writers intern names through
.github/actions/wasm-toolchain/
  action.yml          installs the pinned wasm-bindgen on any CI runner
packages/editor/src/testing/
  reference.ts   @shift/editor/reference-testing: seeded inputs and the number comparison the axis-mapping reference test uses
packages/editor/src/lib/wasm/
  generated/layouts.ts   generated: interfaces and typed calls for every hot call (oxfmt-ignored)
  generated/engineLayouts.ts   generated: the engine module's hot calls, imported only by engineModule.ts
  anchors.ts     followingPlacements: follow_anchors' transforms as matrices (callers import propagateAnchors from generated/layouts.ts, anchorKind from @shift/wasm)
  variation.ts   typed wrappers, handles, and the per-basis weights memo
```

## Key Types

- **`AnchorKind`** — an anchor's role read from its name, as a tsify-typed tagged union.
- **Registries** (`registerAxes`, `registerVariationBasis`, `registerInterpolationBasis`, `registerAxisMappings`) — hold Rust copies of the editor's compiled values, addressed by handle; the editor's `Handles` maps each object to its handle.
- **`Layout`** — a value with a number layout: `read`, `write`, and (in tests) `kind`, the description the TypeScript generator reads. Fields cross in declaration order; a list is its length then its items, an optional value a flag then the value, a name its interned id, an enum its variant index (a string in TypeScript). Locations are not layouts: they are plain numbers in registered-axis order.
- **`@shift/wasm/reference`** — the test-only module's comparison exports: `compileAxisMappings` and `mapLocation`. Their `Reference*` input and output types are generated by tsify and mirror only the fields Rust reads, so the editor's `Axis` and `AxisMapping` satisfy them.

## How it works

### Building

`build.mjs` builds the crate for `wasm32-unknown-unknown` without features into `src/generated/`, with `--features shaping` into `src/generated-shaping/`, and with `--features engine` into `src/generated-engine/`; `build.mjs --reference` builds it with `--features reference` into `src/generated-reference/`. Each build runs wasm-bindgen for the web target, shrinks the module with wasm-opt when `SHIFT_WASM_OPT=1`, and writes it as base64 into `module.ts` (the engine: as `shift_wasm_bg.wasm`), dropping the glue's fetch-by-URL fallback so bundlers emit no stray copy. `src/index.ts` and `src/reference.ts` decode their module and call `initSync` at import. The production bytes do not depend on the reference build. The editor's wrappers in `lib/wasm/` intern names, register axes and bases once, pack inputs into typed arrays, and unpack results; they hold no rules of their own.

Every `@shift/wasm` app build task (`build`, `build:debug`, `build:e2e`) runs the script for the app modules, and `build:reference` runs it for the reference module. The turbo test tasks depend on both, so a reference test needs no step of its own; run `pnpm --filter @shift/wasm build:reference` before running a reference test with vitest directly.

The Nix dev shell provides `wasm-bindgen-cli`; CI jobs install the version `Cargo.lock` pins with `.github/actions/wasm-toolchain` (`taiki-e/install-action`). Updating wasm-bindgen means changing the crate pin, the Nix package, and `Cargo.lock` together. wasm-opt needs no install: `pnpm install` brings it with `@shift/wasm`'s `binaryen` devDependency, so updating it is a `package.json` change.

### Choosing a route

Rust owns every rule the font compiler or format decides, and the editor and export must agree on it. When the editor needs one synchronously, ask: if the Rust changed tomorrow, would the TypeScript disagree with export without anything failing?

- **A rule goes through this module.** Ordering, reversal, structure matching, precedence, model construction: anything a compiler decides. It is a plain-data function in shift-font that native projection calls too, exported here and called through a wrapper. There is no TypeScript copy, not even as a fallback for when the module is missing. A function that returns "no answer" (structures that don't match, a location outside the model) lets the caller fall back to a different rule's output, never to a TypeScript version of the same rule.
- **Arithmetic with no decision in it may stay in TypeScript.** Weighted sums, matrix application, and bounds over live buffers have nothing that can drift beyond float rounding. Each one still gets a `*.reference.test.ts` against the Rust.
- **A rule stays in TypeScript only when measured.** On a per-frame path, calling here costs packing, copying in and out, and unpacking. A rule that stays in TypeScript for that reason needs a measurement of both paths on the same workload, boundary packing included, and a reference test, and gets a line under "What stays in TypeScript" giving the reason. A guess that the boundary is too slow is not a reason; at tens of points a call can cost less than the objects the TypeScript allocates.
- **Split mixed code at the rule.** When one function both decides (which points pair up) and computes (their weighted sum), the deciding part comes here even if the arithmetic stays in TypeScript.
- **One side owns each piece of data.** A number layout is documented once, on the Rust export, and the editor's wrapper packs and unpacks it with no logic of its own. Identity (contour and point ids, output order) is decided on one side, and the export's doc comment says which. Rust returns numbers in a stated order, and the wrapper attaches the ids that order implies.

### Moved from TypeScript, measured

Per-frame geometry now runs here, through glyph-state, with no TypeScript copy and no reference test: segments and tight bounds (`segmentContour` → `contourGeometry`, shift-font's `SegmentIndexIter` and `SegmentIndices::bounds`) and component placements (`composeTransform`, `decomposeMatrix`, shift-font's `DecomposedTransform::to_matrix` and `from_matrix`). Measured on the M4 against the TypeScript they replaced: segments plus bounds of one contour 0.041 against 0.034 ms at 326 points and 2.4 against 1.9 ms at 20,001 (the Rust call alone is 0.47 ms of that); a placement 0.21 against 0.03 µs to compose and 0.30 against 0.01 µs to decompose. Edits themselves, previews included, run in the window's engine (`engineApply`, `enginePreview`). The inverse axis mapping, from a design location back to the external controls, is shift-font's `unmap_location_with_bases` (`unmapAxisLocation`). New glyph and anchor names come from the engine too (`engineNextGlyphName`, `engineNewAnchorName`, over shift-font's `naming`). Pasted SVG path data is parsed by shift-font's `svg_path::contours_from_svg_path`, which the command line uses too, through `svgPathContours`. It is exported from the engine module only, which it grows by 38.9 KB (23 KB gzip, 1.3%); in the module every window embeds it would have added 41.7 KB, 19%.

### What stays in TypeScript

Nothing at present. Blending glyph geometry (`interpolateSourceValues`) was the last: it runs every frame over the live coordinate buffers, drag previews included, which the window's engine does not hold, so the editor packs them into one array and calls `blendSourceValues` (shift-font's `interpolation::blend_values`, the sum `GlyphInterpolation` resolves with). Measured on the M4 with the packing included, against the TypeScript loop it replaced: 0.0038 against 0.0055 ms for 326 points and two sources, 0.021 against 0.020 ms at 5,000, and 0.161 against 0.160 ms at 50,000 (0.279 against 0.293 ms with four sources).

### Reference tests

A rule that stays in TypeScript is tested against the Rust directly, not against a fixture Rust writes: the test builds its inputs in code, runs the TypeScript and the matching `@shift/wasm/reference` export on each, and compares. Nothing can go stale, and a failure names the input.

Inputs come from `@shift/editor/reference-testing`: seeded sweeps (`seededRandom`, fixed seeds). `expectNumbersClose` compares to 9 decimal digits (the two sides run the same float operations, so they agree to about 1e-12). Axis mapping (`packages/editor/src/lib/variation/location.reference.test.ts`) compiles its mappings through `compileAxisMappings`, as the bridge would send them, and compares `mapAxisLocation` with `mapLocation` over a sweep of locations.

The reference module never ships. It is a second instance with its own memory, about 2.5 times the size of the editor's module (it carries the axis-mapping compiler), and its exports would invite calling Rust for rules the editor deliberately runs in TypeScript.

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
nix develop --command pnpm build:wasm                # build src/generated, src/generated-reference, src/generated-shaping, and src/generated-engine
nix develop --command pnpm check                     # tests build every variant first; typecheck builds their declarations
nix develop --command cargo clippy -p shift-wasm --target wasm32-unknown-unknown -- -D warnings
nix develop --command cargo clippy -p shift-wasm --features reference --target wasm32-unknown-unknown -- -D warnings
```

## Related

- [`crates/shift-font/docs/DOCS.md`](../../shift-font/docs/DOCS.md) — the rules every export calls.
- [`packages/editor/src/lib/model/docs/DOCS.md`](../../../packages/editor/src/lib/model/docs/DOCS.md) — where the editor calls them: `Kerning`, axis mapping, and interpolation.
- [`packages/glyph-state/docs/DOCS.md`](../../../packages/glyph-state/docs/DOCS.md) — contour and segment geometry the reference tests check.

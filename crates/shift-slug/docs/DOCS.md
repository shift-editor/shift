# shift-slug

GPU-independent preprocessing for the experimental Slug home/catalog glyph grid.

## Architecture invariants

- **Derived only.** Slug curves, bands, bounds, packing, and GPU pages are rebuildable acceleration data. They never replace canonical `shift.glyph-layer.v1` authored layers.
- **Grid only.** This crate supports catalog previews. It does not replace the editor scene renderer, tools, hit testing, or REGL handles.
- **No GPU ownership.** The crate produces deterministic CPU arrays and bytes shared by native `wgpu` benchmarks and Electron WebGPU. Device, queue, surface, and fallback policy belong to consumers.
- **Checked ranges.** The reference implementation's unchecked 24-bit offset / 8-bit count packing is not used. Atlas offsets and counts are checked `u32` values; packed byte arithmetic is checked `usize`.
- **Bands are location-bound.** The static builder bands one resolved shape. The variable path resolves and re-bands only visible glyphs after every weight update, so current-location membership stays exact without geometry upload.
- **Deterministic topology conversion.** Lines become quadratics. Cubics use the conservative third-derivative error bound from Kurbo's `CubicBez::to_quads`, with a one-font-unit tolerance and equal parameter intervals. Compatible authored sources freeze the maximum subdivision count required by any source so variable topology remains identical.
- **No shaping.** The grid addresses glyphs by dense atlas index and does not need a text shaper.
- **Command ownership.** `OutlineCommand` is a Slug preprocessing input. No standalone packed-outline storage format exists.

## Codemap

```text
src/
  lib.rs       public boundary
  outline.rs   Slug-owned drawing command type
  curve.rs     outline commands -> quadratic curves
  atlas.rs     glyph bounds, horizontal/vertical bands, atlas assembly
  authored.rs            stable shift-font point/segment topology and source derivation
  authored/component.rs  shift-font component program -> resident GPU records
  pack.rs                aligned little-endian GPU upload layout
  render.rs              shared uniform and visible-instance byte layouts
  variable.rs            multi-source resident base/delta model and aligned packing
  variable/component.rs  component records, CPU oracle, and component packing
  resident.rs            complete authored atlas, edit patches, identity maps, and basis deduplication
  error.rs     strict conversion and size failures
shaders/
  slug.wgsl           shared static native-wgpu/Electron-WebGPU renderer
  slug-variable.wgsl  visible curve resolve, GPU re-banding, and variable renderer
examples/
  analyze_font.rs          CPU-only TTF/OTF curve/band sizing harness
  analyze_authored.rs      authored source coverage and random-location validator
  benchmark_wgpu.rs        adapter probe plus native offscreen render/readback benchmark
  benchmark_variable_wgpu.rs variable compute scratch/readback validator
tests/
  atlas.rs     conversion, band, range, shader-layout, and packing invariants
```

## Static atlas layout

The packed upload contains four independently aligned sections:

```text
Curve[]       3 × vec2<f32>                              24 bytes each
u32[]         global u32 indexes or paired local u16s      4 bytes/word
Glyph[]       bounds + curve/band ranges                  32 bytes each
Band[]        u32 start + u32 count                        8 bytes each
```

Each glyph owns `band_count` horizontal ranges followed by `band_count` vertical ranges. Empty glyphs have zero curves and empty ranges but retain a descriptor, so dense glyph indexing remains stable.

`CurveIndexEncoding::GlobalU32` stores the checked CPU indexes directly. `GlyphLocalU16` subtracts each glyph's `curve_start` and packs two indexes per shader word; it rejects glyphs with more than 65,536 curves. Source Han's maximum is 561. The benchmark uses wide indexes by default and exposes compact indexes through `--compact-indices`.

## Resident variable execution

`build_authored_atlas()` is the product complete-font residency boundary. It delegates to `build_authored_atlas_page()` with every root so complete residency and local edit patches share one compiler and packed layout. A patch compiles an ordered root-glyph batch plus transitive component geometry, preserves explicit `GlyphId` mapping, and deduplicates interpolation bases across that closure. Layerless root records receive zero-curve/zero-advance descriptors so one incomplete draft cannot disable the rest of the grid. Complete atlases and patches are location-independent; axis movement changes only their shared weight vectors and visible instances.

The variable model keeps one base quadratic array plus base-relative `f32` source deltas. Each 8-byte source descriptor remains dense by default; only a source whose unchanged curves make sparse storage strictly smaller receives a tagged offset into a compact side table of sorted glyph-local indexes. Dense fonts therefore pay no sparse metadata tax. Each source references a global weight index so equal interpolation bases share a small per-frame weight vector. The complete packed atlas remains one logical byte stream but may span two `array<u32>` storage bindings. A split offset and every logical section offset fit in the existing 64-byte uniform; one accessor selects the physical buffer without changing packed bytes. Typed WGSL decoders preserve the exact little-endian resident layout while using exactly eight storage bindings in the resolve entry point, matching WebGPU's baseline binding-count and 128 MiB storage-binding limits. Compute preserves the full weighted-source equation as `base × sum(weights) + Σ(weight × delta)`, rather than assuming weights always sum to one. A one-bit-per-curve resident mask marks controls generated from authored lines: after endpoint interpolation, compute regenerates those controls with Slug's normalized perpendicular epsilon because that operation is nonlinear and cannot be represented exactly by source control deltas. One workgroup per visible glyph resolves curves and reduces exact current-location bounds into scratch; a second pass rebuilds the eight horizontal and vertical bands using those bounds. Fragment band selection reads the same scratch bounds. Cell sizing remains a consumer-owned metrics/advance transform, so neither loose all-location bounds nor current-location geometry can shrink or jump the grid layout. Offscreen glyphs perform none of this work until visible.

For 150 uniformly sampled Source Han glyphs, worst-case scratch reservation is bounded by the visible curves and `curve_count × 16` temporary band-index slots rather than all 65,535 glyphs. Component glyphs additionally reserve two 32-byte affine transforms per visible component occurrence; direct glyphs pay no component scratch. Full authored CJK import remains a subsequent model layer.

Curve correspondence comes from stable authored/raw point topology. `AuthoredCurveTopology` captures contour IDs, point IDs and kinds, segment-to-point indexes, and the maximum cubic subdivision count required across compatible layers; every compatible source applies its ordered numeric values to a clone of that same structure. Degenerate lines therefore retain correspondence instead of disappearing from one callback stream. `VariableAtlasBuilder::add_glyph` remains only a compatible-fixture convenience. Source Han glyph 1663 demonstrated why: skrifa emitted different resolved pen command kinds at `wght=100` and `wght=900`, even though compiled-font point variation may remain valid. Pairing those callbacks would silently associate unrelated curves.

The authored `shift-font` variable fixture matches native midpoint projection within 0.001 font units. Exact-source shape or relationship exceptions anywhere in a component closure are retained as separate static resident glyphs; `AuthoredGlyph` selects them by source identity through a visible-instance update rather than fabricating correspondence or uploading geometry. Atlas insertion is transactional across the compatible default and all variants. Transactions use append checkpoints and truncation rollback rather than cloning the growing atlas, preserving bounded build memory at full-font scale.

The general component path compiles `shift-font::GlyphComponents` directly: Rust remains authoritative for authored order, ancestry, branch-local cycle pruning, and `_name` anchor matching. GPU records evaluate all nine decomposed transform fields with each parent glyph's own interpolation basis, evaluate source and target anchors with their owning glyph bases, apply Rust-selected attachment offsets, and compose nested transforms parent-before-child. `AuthoredAtlasBuilder` deduplicates direct root and component contours only within one explicit atlas generation; authored edits build a new generation rather than consulting a stale identity cache. Component contours are transformed only while visible. Synthetic line controls are regenerated after final component transformation.

The real MutatorSans designspace has 49 glyphs. All 49 build, including 10 glyphs / 20 nested component occurrences. Four deduplicated interpolation bases / 21 weight slots produce 564 unique base curves, 1,813 stored delta curves, three sparse indexes, 203 curve-source descriptors, 30 component parts, 20 component records / 80 transform sources, and 59 atlas descriptors in 68,760 bytes including variable advances. Across all seven authored source locations plus 17 deterministic multi-axis locations, maximum curve error is 0.000183 font units and maximum advance error is 0.000122 units. Separate fixtures cover varying scale, rotation, skew, centers, nested composition, variable anchor attachment, and component interpolation bases that differ from the root; the component compute shader is also checked on a real `wgpu` adapter.

The real Host Grotesk variable UI font exercises 448 glyphs / 9,481 curves across `wght=100..900`: base, midpoint, and source GPU scratch readback have zero coordinate error, generated band membership matches the CPU oracle exactly, and endpoint/midpoint fragment checksums differ as expected. Sparse support alone leaves its dense geometry bytes unchanged; resident variable advances bring the packed atlas to 481,444 bytes. GPU readback has zero advance error. A 150-glyph pass uses 298,784 bytes of visible scratch, including exact bounds and advances.

A diagnostic compiled-outline sweep covers all 65,535 Source Han glyph IDs at `wght=250` and `900`. Because independently resolved callbacks disagree structurally for 3,068 glyphs, the sizing harness retains those source shapes as exact resident variants rather than claiming production correspondence. The resulting 68,603 atlas glyphs contain 5,817,677 base curves, 5,148,741 stored deltas, 4,100 sparse indexes, and source advances in 267,831,980 bytes (255.424 MiB): 0.576 MiB below the preferred 256 MiB gate and well below the 500 MiB stop. Build time is 835 ms and deterministic serialization is 270 ms on the Linux harness. `write_packed_chunks` emits 64 bounded 4 MiB writes without a contiguous packed copy, reducing measured peak RSS from 582.8 to 363.8 MiB; the consumer can drop the authored atlas immediately after residency.

Apple M4 / Metal measurements use 120 serialized frames that each change weights, resolve visible curves, rebuild visible bands, render, submit, and wait for completion:

| Commit                                          | Weight update | Packed Host atlas |      p50 |      p95 |      p99 |      max |
| ----------------------------------------------- | ------------: | ----------------: | -------: | -------: | -------: | -------: |
| `f32ebd40` two-source scalar                    |    16 B/frame |         469,504 B | 0.934 ms | 2.120 ms | 4.257 ms | 5.857 ms |
| `ff6ab527` indexed multi-source weights         |     8 B/frame |         476,672 B | 0.754 ms | 1.640 ms | 1.967 ms | 3.441 ms |
| `f5dc1281` authored topology + exact lines      |     8 B/frame |         477,860 B | 1.048 ms | 2.177 ms | 4.234 ms | 4.302 ms |
| `9c0b6510` components + exact visible bounds    |     8 B/frame |         477,860 B | 1.001 ms | 2.554 ms | 4.761 ms | 4.949 ms |
| `28bfe2ab` general components, three-run median |     8 B/frame |         481,444 B | 1.794 ms | 2.149 ms | 3.902 ms | 4.033 ms |

The indexed-weight run observed 19.3% lower p50, 22.6% lower p95, and 53.8% lower p99 than the initial scalar run while halving weight traffic to 960 bytes total. The authored-topology correction then added a one-bit-per-curve line mask and exact post-interpolation line controls. In one run it measured 39.0% higher p50, 32.7% higher p95, and 115.3% higher p99 than `ff6ab527`, while GPU submit/readback improved 11.5% from 6.474 to 5.729 ms. Treat all latency differences as run-to-run observations rather than isolated causal attribution.

The `9c0b6510` run includes the component fast path and exact visible-bound reduction, which adds 16 scratch bytes per visible glyph and a ninth compute storage binding. It built in 1.373 ms, completed GPU submit/readback in 5.775 ms, retained zero geometry uploads and 960 weight bytes, passed curve and band validation, and preserved checksum `c1cd8eb7631a65db`. Relative to the preceding `f5dc1281` run, p50 improved 4.5% while p95, p99, and max were 17.3%, 12.4%, and 15.0% higher. Treat these as run-to-run observations.

The `28bfe2ab` general-component model was measured in three separate 120-frame runs on macOS 26.3.1. Three-run medians were 2.326 ms build, 6.137 ms GPU submit/readback, and 1.794 / 2.149 / 3.902 / 4.033 ms serialized p50/p95/p99/max. Against `9c0b6510`, those medians are +69.4% build, +6.3% submit/readback, +79.2% p50, -15.9% p95, -18.0% p99, and -18.5% max; treat them as run-to-run observations rather than isolated attribution. Every run retained the 481,444-byte Host atlas, 298,784 scratch bytes, zero curve/advance error, exact bands, zero geometry uploads, 960 weight bytes, and checksum `c1cd8eb7631a65db`. The component-specific Metal correctness test also passed. The p95 retains 6.151 ms below the preferred 8.3 ms gate and p99 retains 12.798 ms below the 16.7 ms hard gate. That measured revision used eighteen storage bindings. The current byte-addressed resident-atlas shader uses seven in its largest entry point; its Electron presentation timing remains to be measured.

## Reference implementation

The design is informed by Gabriel Dubé's MIT implementation:

- <https://gabdube.github.io/articles/rust_slug/rust_slug.html>
- <https://github.com/gabdube/rust-slug-wgpu>

The article's 9.5 ms result shapes roughly 49,000 characters while lazily producing a 69 KB OpenSans atlas; it is not a 49,000-unique-glyph preprocessing result. Shift measures every Source Han glyph ID directly.

See `THIRD_PARTY.md` for attribution.

## Initial Source Han CPU baseline — 2026-07-26

`analyze_font` processed all 65,535 glyph IDs from `SourceHanSans-VF.ttf` at `wght=900` without a GPU:

```text
curves                    5,489,475
max curves/glyph                561
8-band curve indexes      18,391,951
8-band packed bytes      215,801,216 (205.8 MiB)
band occupancy p50/p95/p99/max  17 / 33 / 42 / 153
release build time             ~1.4–1.8 s
analyzer peak RSS              ~251 MiB after a warm build
```

The reference 8-bit band count happened to fit this corpus, but its global 24-bit offset did not: 109,479 band ranges started beyond `0x00ff_ffff`. Shift's wider checked ranges are required.

Band-count tradeoff at `wght=900`:

| Bands/direction | Packed bytes | Occupancy p95 / max |  Build |
| --------------: | -----------: | ------------------: | -----: |
|               4 |    186.3 MiB |            51 / 215 | 1.57 s |
|               8 |    205.8 MiB |            33 / 153 | 1.78 s |
|              12 |    224.9 MiB |            27 / 126 | 1.58 s |
|              16 |    244.2 MiB |            24 / 102 | 2.02 s |

Eight bands remain the initial static-render candidate. The 5.49 million curves alone occupy 125.6 MiB at three `vec2<f32>` values each. Variable residency therefore needs base-plus-sparse-delta measurement; duplicating complete curve arrays per source is not acceptable by default. Per-glyph curve counts fit `u16` in this corpus, so packing two glyph-local curve indexes per `u32` is a promising derived optimization to measure without weakening checked CPU ranges.

## Native offscreen baseline

The native harness uses `SLUG_WGSL` and the exact `PackedAtlas` bytes exposed for Electron. It renders a uniformly sampled visible grid to `Rgba8Unorm`, reads pixels back, emits a checksum, and measures render-pass boundaries when timestamp queries are available. Its default 960×640 workload contains 150 visible 64-pixel cells.

Visible instances carry an independent pixel-to-font transform, so consumers can tighten rasterized quads without changing fragment sampling. The benchmark uses one-pixel-guarded glyph quads by default and retains `--full-cell-quads` as an A/B control. Tight and full modes must produce identical checksums.

Two measurements are reported separately:

- **Latency:** one encoder, submission, and completion wait per pass. `latency_submit_to_completion_ms_*` is the serialized native upper bound; `latency_gpu_pass_ms_*` is the corresponding GPU timestamp interval.
- **Throughput:** every pass is encoded into one saturated batch. `throughput_batch_wall_ms` and `wall_ms_per_pass` describe batch throughput, not individual-frame latency.

Timestamp pairs with `end < start` are excluded and reported as `non_monotonic_pairs`; they are never converted with wrapping subtraction. Electron presentation timing is still a separate product measurement.

On llvmpipe, tight quads reduced MutatorSans GPU latency from 6.36 ms to 3.68 ms while producing the same checksum. The uniformly sampled Source Han workload produced the same checksum but no meaningful timing change because CJK bounds occupy nearly the complete cell. Tight quads remain useful for Latin and sparse glyphs without regressing CJK correctness.

Eight-band compact Source Han indexes reduce the atlas from 205.8 MiB to 170.7 MiB. On Apple M4 / Metal they preserved byte-identical pixels but increased serialized GPU latency p50 from 0.508 ms to 0.675 ms, outside the five-percent retention gate; wide indexes therefore remain the default. Wide and compact shader entry points are intentionally static and share one WGSL file. An override branch or helper call inside the dynamic curve loop caused llvmpipe's first submission not to complete; inline decoding in a dedicated compact fragment path avoids that driver/compiler boundary.

A full Source Han `wght=900` llvmpipe correctness run rendered 192 visible instances at 1024×768:

```text
atlas buffer creation    161.2 ms
first warm submission    397.6 ms
GPU pass p50/p95          19.50 / 19.79 ms
pixel checksum            a57dae78d2cc2a36
```

llvmpipe is CPU rasterization and is not production performance evidence. It proves that the complete 205.8 MiB atlas passes native `wgpu` validation, the shared shader runs, timestamps resolve, and pixels read back.

The target MacBook Air native-wgpu probe reports Apple M4/Metal, timestamp-query support, a 4 GiB maximum buffer and storage binding, 29 storage buffers per stage, and 32-byte storage-offset alignment. Electron 40.1.0 / Chromium 144 exposes ten storage buffers through Dawn on the same machine, including when adapter-limit tiering is disabled. Native limits therefore are not product-authoritative. The shared shader uses eight storage bindings in its largest entry point and partitions resident bytes when necessary so each physical binding fits the adapter limit. Packaged Electron/Dawn presentation remains the product acceptance environment.

## Verification

```bash
cargo test -p shift-slug --all-features
cargo clippy -p shift-slug --all-targets --all-features -- -D warnings
cargo run --release -p shift-slug --example analyze_font -- /path/to/font.ttf
cargo run --release -p shift-slug --features wgpu-benchmark \
  --example benchmark_wgpu -- /path/to/font.ttf \
  --iterations 120 --output /tmp/shift-slug.pgm wght=900
cargo run --release -p shift-slug --features wgpu-benchmark \
  --example benchmark_wgpu -- /path/to/font.otf \
  --width 320 --height 64 --cell-size 64 --iterations 1 \
  --comparison-output /tmp/shift-slug-comparison.png
cargo run --release -p shift-slug --features wgpu-benchmark \
  --example benchmark_variable_wgpu -- /path/to/font.ttf \
  wght=100,900 --weight 0.5
```

With no font argument, `benchmark_wgpu` only prints adapter capabilities. `--comparison-output` writes a three-row PNG containing the original cubic-capable CPU raster, the Slug quadratic raster, and their red alpha difference, and prints soft intersection-over-union and normalized alpha error. The analyzer remains CPU-only. The native benchmark is a correctness and diagnostic harness; packaged Electron/Dawn remains the product acceptance environment.

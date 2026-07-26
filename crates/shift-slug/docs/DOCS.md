# shift-slug

GPU-independent preprocessing for the experimental Slug home/catalog glyph grid.

## Architecture invariants

- **Derived only.** Slug curves, bands, bounds, packing, and GPU pages are rebuildable acceleration data. They never replace canonical `shift.glyph-layer.v1` authored layers.
- **Grid only.** This crate supports catalog previews. It does not replace the editor scene renderer, tools, hit testing, or REGL handles.
- **No GPU ownership.** The crate produces deterministic CPU arrays and bytes shared by native `wgpu` benchmarks and Electron WebGPU. Device, queue, surface, and fallback policy belong to consumers.
- **Checked ranges.** The reference implementation's unchecked 24-bit offset / 8-bit count packing is not used. Atlas offsets and counts are checked `u32` values; packed byte arithmetic is checked `usize`.
- **Bands are location-bound.** The static builder bands one resolved shape. The variable path resolves and re-bands only visible glyphs after every weight update, so current-location membership stays exact without geometry upload.
- **Deterministic topology conversion.** Lines become quadratics and cubics become two quadratics with fixed rules. Compatible authored sources must pass through the same structural conversion.
- **No shaping.** The grid addresses glyphs by dense atlas index and does not need a text shaper.

## Codemap

```text
src/
  lib.rs       public boundary
  curve.rs     outline commands -> quadratic curves
  atlas.rs     glyph bounds, horizontal/vertical bands, atlas assembly
  pack.rs      aligned little-endian GPU upload layout
  render.rs    shared uniform and visible-instance byte layouts
  variable.rs  multi-source resident base/delta model and aligned packing
  error.rs     strict conversion and size failures
shaders/
  slug.wgsl           shared static native-wgpu/Electron-WebGPU renderer
  slug-variable.wgsl  visible curve resolve, GPU re-banding, and variable renderer
examples/
  analyze_font.rs          CPU-only TTF/OTF curve/band sizing harness
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

The variable model keeps one base quadratic array plus one dense `f32` delta block per additional compatible source. Each glyph references source descriptors whose global weight indexes allow equal interpolation bases to share a small per-frame weight vector. Compute preserves the full weighted-source equation as `base × sum(weights) + Σ(weight × delta)`, rather than assuming weights always sum to one. One workgroup per visible glyph resolves curves into scratch; a second pass rebuilds the eight horizontal and vertical bands for only those resolved curves. Fragment rendering therefore sees exact current-location membership without uploading geometry or retaining all-location conservative indexes.

For 150 uniformly sampled Source Han glyphs, worst-case scratch reservation is bounded by the visible curves and `curve_count × 16` temporary band-index slots rather than all 65,535 glyphs. Multi-source sparse deltas, component evaluation, attachments, and exact-source topology variants remain subsequent model layers.

Curve correspondence must come from stable authored/raw point topology. `VariableAtlasBuilder::add_glyph` compares command topology and exists for compatible fixtures; production adapters should derive corresponding curves from one shared segment recipe and call `add_curve_glyph`. Source Han glyph 1663 demonstrated why: skrifa emitted different resolved pen command kinds at `wght=100` and `wght=900`, even though compiled-font point variation may remain valid. Pairing independently resolved callback streams would silently associate unrelated curves, so the builder rejects it.

The authored `shift-font` variable fixture matches native midpoint projection within 0.001 font units. The real Host Grotesk variable UI font exercises 448 glyphs / 9,481 curves across `wght=100..900`: base, midpoint, and source GPU scratch readback have zero coordinate error, generated band membership matches the CPU oracle exactly, and endpoint/midpoint fragment checksums differ as expected. A 150-glyph pass uses about 289 KiB of visible scratch.

Apple M4 / Metal measurements use 120 serialized frames that each change weights, resolve visible curves, rebuild visible bands, render, submit, and wait for completion:

| Commit | Weight update | Packed Host atlas | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `f32ebd40` two-source scalar | 16 B/frame | 469,504 B | 0.934 ms | 2.120 ms | 4.257 ms | 5.857 ms |
| `ff6ab527` indexed multi-source weights | 8 B/frame | 476,672 B | 0.754 ms | 1.640 ms | 1.967 ms | 3.441 ms |

The generalized run observed 19.3% lower p50, 22.6% lower p95, and 53.8% lower p99 while halving weight traffic to 960 bytes total. Its packed Host atlas grew by 7,168 bytes (1.53%) for source descriptors and alignment. Geometry uploads and geometry-upload bytes remained zero, GPU submit/readback took 6.474 ms, scratch curve error was zero, curve and band validation passed, and the validation frame checksum remained `bb147484ca434754`. The improvement is an observed run-to-run comparison, not yet an isolated causal attribution. This proves the resident delta, indexed-weight, visible re-banding, and fragment mechanics, not yet complete product variation semantics.

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

| Bands/direction | Packed bytes | Occupancy p95 / max | Build |
| ---: | ---: | ---: | ---: |
| 4 | 186.3 MiB | 51 / 215 | 1.57 s |
| 8 | 205.8 MiB | 33 / 153 | 1.78 s |
| 12 | 224.9 MiB | 27 / 126 | 1.58 s |
| 16 | 244.2 MiB | 24 / 102 | 2.02 s |

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

The target MacBook Air adapter probe reports Apple M4/Metal, timestamp-query support, a 4 GiB maximum buffer and storage binding, 29 storage buffers per stage, and 32-byte storage-offset alignment. The atlas therefore clears this adapter's structural limits. Physical-Metal timing remains to be measured with the full command below.

## Verification

```bash
cargo test -p shift-slug --all-features
cargo clippy -p shift-slug --all-targets --all-features -- -D warnings
cargo run --release -p shift-slug --example analyze_font -- /path/to/font.ttf
cargo run --release -p shift-slug --features wgpu-benchmark \
  --example benchmark_wgpu -- /path/to/font.ttf \
  --iterations 120 --output /tmp/shift-slug.pgm wght=900
cargo run --release -p shift-slug --features wgpu-benchmark \
  --example benchmark_variable_wgpu -- /path/to/font.ttf \
  wght=100,900 --weight 0.5
```

With no font argument, `benchmark_wgpu` only prints adapter capabilities. The analyzer remains CPU-only. The native benchmark is a correctness and diagnostic harness; packaged Electron/Dawn remains the product acceptance environment.

# shift-slug

GPU-independent preprocessing for the experimental Slug home/catalog glyph grid.

## Architecture invariants

- **Derived only.** Slug curves, bands, bounds, packing, and GPU pages are rebuildable acceleration data. They never replace canonical `shift.glyph-layer.v1` authored layers.
- **Grid only.** This crate supports catalog previews. It does not replace the editor scene renderer, tools, hit testing, or REGL handles.
- **No GPU ownership.** The crate produces deterministic CPU arrays and bytes shared by native `wgpu` benchmarks and Electron WebGPU. Device, queue, surface, and fallback policy belong to consumers.
- **Checked ranges.** The reference implementation's unchecked 24-bit offset / 8-bit count packing is not used. Atlas offsets and counts are checked `u32` values; packed byte arithmetic is checked `usize`.
- **Static bands are location-bound.** The first builder bands one resolved shape. Variable-font support must build conservative bands across every legal source contribution before weights may change without geometry upload.
- **Deterministic topology conversion.** Lines become quadratics and cubics become two quadratics with fixed rules. Compatible authored sources must pass through the same structural conversion.
- **No shaping.** The grid addresses glyphs by dense atlas index and does not need a text shaper.

## Codemap

```text
src/
  lib.rs       public boundary
  curve.rs     outline commands -> quadratic curves
  atlas.rs     glyph bounds, horizontal/vertical bands, atlas assembly
  pack.rs      aligned little-endian GPU upload layout
  error.rs     strict conversion and size failures
examples/
  analyze_font.rs  CPU-only TTF/OTF curve/band sizing harness
tests/
  atlas.rs     conversion, band, range, and packing invariants
```

## Static atlas layout

The packed upload contains four independently aligned sections:

```text
Curve[]       3 × vec2<f32>                         24 bytes each
u32[]         curve indexes grouped by glyph/band    4 bytes each
Glyph[]       bounds + curve/band ranges             32 bytes each
Band[]        u32 start + u32 count                   8 bytes each
```

Each glyph owns `band_count` horizontal ranges followed by `band_count` vertical ranges. Empty glyphs have zero curves and empty ranges but retain a descriptor, so dense glyph indexing remains stable.

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

## Verification

```bash
cargo test -p shift-slug
cargo clippy -p shift-slug --all-targets -- -D warnings
cargo run --release -p shift-slug --example analyze_font -- /path/to/font.ttf
```

The analyzer is CPU-only and works on machines without a GPU. A native headless `wgpu` benchmark will consume the same packed layout in a later slice; Electron/Dawn remains the product acceptance environment.

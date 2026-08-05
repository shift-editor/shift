use std::env;
use std::error::Error;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use shift_backends::{
    build_binary_atlas_page, BinaryFont, FontSource, GlyphIndex, SourceAtlasDescriptor,
};
use shift_slug::{PackedVariableAtlas, DEFAULT_BAND_COUNT};

const ROOTS_PER_PAGE: usize = 256;
const ALIGNMENT: usize = 256;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn main() -> Result<()> {
    let path = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: profile_binary_atlas <font.ttf>")?;
    let open_started = Instant::now();
    let source = BinaryFont::open(&path)?;
    let open_elapsed = open_started.elapsed();
    let roots = source
        .directory()
        .glyphs
        .iter()
        .map(|glyph| glyph.index)
        .collect::<Vec<GlyphIndex>>();
    let mut packed_pages = Vec::<PackedVariableAtlas>::new();
    let mut descriptors = Vec::<SourceAtlasDescriptor>::new();
    let mut build_samples = Vec::new();
    let mut pack_samples = Vec::new();
    let mut packed_bytes = 0_usize;
    let mut maximum_page_bytes = 0_usize;
    let mut base_curves = 0_usize;
    let mut delta_curves = 0_usize;
    let mut sparse_delta_indices = 0_usize;
    let mut sources = 0_usize;
    let mut maximum_weights = 0_usize;

    let complete_started = Instant::now();
    for page_roots in roots.chunks(ROOTS_PER_PAGE) {
        let build_started = Instant::now();
        let page = build_binary_atlas_page(&source, page_roots, DEFAULT_BAND_COUNT)?;
        build_samples.push(build_started.elapsed());
        let (atlas, descriptor) = page.into_parts();
        let statistics = atlas.statistics();
        base_curves += statistics.curve_count;
        delta_curves += statistics.delta_curve_count;
        sparse_delta_indices += statistics.delta_index_count;
        sources += statistics.source_count;
        maximum_weights = maximum_weights.max(
            descriptor
                .weights(source.directory().default_location())?
                .len(),
        );

        let pack_started = Instant::now();
        let packed = atlas.pack(ALIGNMENT)?;
        pack_samples.push(pack_started.elapsed());
        let page_bytes = packed.as_bytes().len();
        packed_bytes = packed_bytes
            .checked_add(page_bytes)
            .ok_or("packed byte count overflow")?;
        maximum_page_bytes = maximum_page_bytes.max(page_bytes);
        packed_pages.push(packed);
        descriptors.push(descriptor);
    }
    let complete_elapsed = complete_started.elapsed();
    let weights_started = Instant::now();
    for descriptor in &descriptors {
        descriptor.weights(source.directory().default_location())?;
    }
    let weights_elapsed = weights_started.elapsed();
    let build_total = build_samples.iter().sum::<Duration>();
    let pack_total = pack_samples.iter().sum::<Duration>();
    build_samples.sort_unstable();
    pack_samples.sort_unstable();

    println!("source={}", path.display());
    println!(
        "open_ms={:.3} glyphs={} pages={} roots_per_page={} complete_ms={:.3}",
        milliseconds(open_elapsed),
        roots.len(),
        packed_pages.len(),
        ROOTS_PER_PAGE,
        milliseconds(complete_elapsed),
    );
    println!(
        "build_ms={:.3} page_p50_ms={:.3} page_p95_ms={:.3}",
        milliseconds(build_total),
        milliseconds(percentile(&build_samples, 0.50)),
        milliseconds(percentile(&build_samples, 0.95)),
    );
    println!(
        "pack_ms={:.3} page_p50_ms={:.3} page_p95_ms={:.3}",
        milliseconds(pack_total),
        milliseconds(percentile(&pack_samples, 0.50)),
        milliseconds(percentile(&pack_samples, 0.95)),
    );
    println!(
        "packed_bytes={} maximum_page_bytes={} base_curves={} delta_curves={} sparse_delta_indices={} sources={} maximum_weights={} all_page_weights_ms={:.3}",
        packed_bytes,
        maximum_page_bytes,
        base_curves,
        delta_curves,
        sparse_delta_indices,
        sources,
        maximum_weights,
        milliseconds(weights_elapsed),
    );
    Ok(())
}

fn percentile(samples: &[Duration], fraction: f64) -> Duration {
    samples
        .get(((samples.len().saturating_sub(1)) as f64 * fraction) as usize)
        .copied()
        .unwrap_or_default()
}

fn milliseconds(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

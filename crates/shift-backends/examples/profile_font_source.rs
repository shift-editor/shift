use std::hint::black_box;
use std::path::Path;
use std::time::{Duration, Instant};

use rayon::prelude::*;
use shift_backends::{BinaryFont, FontSource, ProjectedGlyph};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Err("run this profiler with --release".into());
    }
    let mut arguments = std::env::args().skip(1);
    let path = arguments
        .next()
        .ok_or("usage: profile_font_source <font.ttf|font.otf> [glyph-name] [iterations]")?;
    let requested_glyph = arguments.next();
    let iterations = arguments
        .next()
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(200)
        .max(1);

    let open_started = Instant::now();
    let font = BinaryFont::open(Path::new(&path))?;
    let open_and_directory = open_started.elapsed();
    let directory = font.directory();
    let selected = requested_glyph
        .as_deref()
        .and_then(|name| directory.glyphs.iter().find(|glyph| glyph.name == name))
        .or_else(|| directory.glyphs.get(directory.glyphs.len() / 2))
        .ok_or("font directory is empty")?;
    let selected_index = selected.index;
    let selected_name = selected.name.clone();
    let glyphs = directory
        .glyphs
        .iter()
        .map(|glyph| glyph.index)
        .collect::<Vec<_>>();

    black_box(font.glyph(selected_index)?);
    let selected_samples = sample(iterations, || font.glyph(selected_index))?;

    let sequential_started = Instant::now();
    let sequential = glyphs
        .iter()
        .map(|glyph| font.glyph(*glyph).map(summarize))
        .collect::<Result<Vec<_>, _>>()?;
    let sequential_elapsed = sequential_started.elapsed();
    let sequential_checksum = checksum(&sequential);

    let parallel_started = Instant::now();
    let parallel = glyphs
        .par_iter()
        .map(|glyph| font.glyph(*glyph).map(summarize))
        .collect::<Result<Vec<_>, _>>()?;
    let parallel_elapsed = parallel_started.elapsed();
    let parallel_checksum = checksum(&parallel);
    if sequential_checksum != parallel_checksum {
        return Err("sequential and parallel projection checksums disagree".into());
    }

    println!("source: {path}");
    println!(
        "directory: {} glyphs, {} axes, {:.3} ms open + directory",
        glyphs.len(),
        directory.axes.len(),
        millis(open_and_directory)
    );
    print_samples(
        &format!("selected projection ({selected_name}, {selected_index:?})"),
        &selected_samples,
    );
    println!(
        "complete sequential: {:.3} ms ({:.1} glyphs/ms)",
        millis(sequential_elapsed),
        glyphs.len() as f64 / millis(sequential_elapsed)
    );
    println!(
        "complete parallel:   {:.3} ms ({:.1} glyphs/ms, {} Rayon threads)",
        millis(parallel_elapsed),
        glyphs.len() as f64 / millis(parallel_elapsed),
        rayon::current_num_threads()
    );
    println!("projection checksum: {sequential_checksum}");
    if let Some(mebibytes) = peak_rss_mebibytes() {
        println!("peak RSS: {mebibytes:.1} MiB");
    }
    Ok(())
}

fn sample(
    iterations: usize,
    mut read: impl FnMut() -> Result<ProjectedGlyph, shift_backends::FontReadError>,
) -> Result<Vec<Duration>, shift_backends::FontReadError> {
    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started = Instant::now();
        black_box(read()?);
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    Ok(samples)
}

fn print_samples(label: &str, samples: &[Duration]) {
    let median = samples[samples.len() / 2];
    let p95_index = (samples.len() * 95).div_ceil(100).saturating_sub(1);
    let p95 = samples[p95_index];
    println!(
        "{label}: {:.3} ms p50, {:.3} ms p95 ({} reads)",
        millis(median),
        millis(p95),
        samples.len()
    );
}

fn summarize(glyph: ProjectedGlyph) -> (usize, usize, usize, i64) {
    let projections = std::iter::once(&glyph.root).chain(glyph.components.iter());
    let mut contour_count = 0;
    let mut component_count = 0;
    let mut value_count = 0;
    for projection in projections {
        contour_count += projection.fallback.contours.len();
        component_count += projection.fallback.components.len();
        value_count += projection.fallback.values.len();
        value_count += projection
            .variation
            .iter()
            .flat_map(|variation| variation.deltas.iter())
            .map(|delta| delta.values.len())
            .sum::<usize>();
    }
    (
        contour_count,
        component_count,
        value_count,
        glyph.root.fallback.values[0].round() as i64,
    )
}

fn checksum(summaries: &[(usize, usize, usize, i64)]) -> i64 {
    summaries
        .iter()
        .map(|(contours, components, values, advance)| {
            *contours as i64 * 31 + *components as i64 * 37 + *values as i64 * 41 + *advance
        })
        .sum()
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

#[cfg(unix)]
fn peak_rss_mebibytes() -> Option<f64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
        return None;
    }
    let rss = unsafe { usage.assume_init() }.ru_maxrss as f64;
    #[cfg(target_os = "macos")]
    return Some(rss / 1_048_576.0);
    #[cfg(not(target_os = "macos"))]
    Some(rss / 1_024.0)
}

#[cfg(not(unix))]
fn peak_rss_mebibytes() -> Option<f64> {
    None
}

use std::hint::black_box;
use std::path::Path;
use std::time::{Duration, Instant};

use rayon::prelude::*;
use shift_backends::{
    BinaryFont, DisplayGlyph, RandomAccessFont, VariationAxisKind, VariationCoordinate,
};

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
    let default_location = directory.default_location().clone();
    let non_default_location = directory.axes.first().map(|axis| {
        let value = match &axis.kind {
            VariationAxisKind::Continuous { maximum, .. } => *maximum,
            VariationAxisKind::Discrete { values, .. } => values[values.len() - 1],
        };
        directory.location(&[VariationCoordinate {
            axis: axis.index,
            value,
        }])
    });
    let glyphs = directory
        .glyphs
        .iter()
        .map(|glyph| glyph.index)
        .collect::<Vec<_>>();

    black_box(font.read_glyph(selected_index, &default_location)?);
    let default_samples = sample(iterations, || {
        font.read_glyph(selected_index, &default_location)
    })?;
    let non_default_samples = non_default_location
        .transpose()?
        .map(|location| sample(iterations, || font.read_glyph(selected_index, &location)))
        .transpose()?;

    let sequential_started = Instant::now();
    let sequential = glyphs
        .iter()
        .map(|glyph| font.read_glyph(*glyph, &default_location).map(summarize))
        .collect::<Result<Vec<_>, _>>()?;
    let sequential_elapsed = sequential_started.elapsed();
    let sequential_checksum = checksum(&sequential);

    let parallel_started = Instant::now();
    let parallel = glyphs
        .par_iter()
        .map(|glyph| font.read_glyph(*glyph, &default_location).map(summarize))
        .collect::<Result<Vec<_>, _>>()?;
    let parallel_elapsed = parallel_started.elapsed();
    let parallel_checksum = checksum(&parallel);
    if sequential_checksum != parallel_checksum {
        return Err("sequential and parallel resolution checksums disagree".into());
    }

    println!("source: {path}");
    println!(
        "directory: {} glyphs, {} axes, {:.3} ms open + directory",
        glyphs.len(),
        directory.axes.len(),
        millis(open_and_directory)
    );
    print_samples(
        &format!("selected default ({selected_name}, {selected_index:?})"),
        &default_samples,
    );
    if let Some(samples) = non_default_samples {
        print_samples("selected non-default", &samples);
    }
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
    println!("resolution checksum: {sequential_checksum}");
    if let Some(mebibytes) = peak_rss_mebibytes() {
        println!("peak RSS: {mebibytes:.1} MiB");
    }
    Ok(())
}

fn sample(
    iterations: usize,
    mut read: impl FnMut() -> Result<DisplayGlyph, shift_backends::FontReadError>,
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

fn summarize(glyph: DisplayGlyph) -> (usize, usize, usize, i64) {
    (
        glyph.geometries.len(),
        glyph.components.len(),
        glyph.points.len(),
        glyph.metrics.x_advance.round() as i64,
    )
}

fn checksum(summaries: &[(usize, usize, usize, i64)]) -> i64 {
    summaries
        .iter()
        .map(|(geometries, components, points, advance)| {
            *geometries as i64 * 31 + *components as i64 * 37 + *points as i64 * 41 + *advance
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

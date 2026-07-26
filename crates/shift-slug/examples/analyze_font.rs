use std::{env, error::Error, fs, path::PathBuf, time::Instant};

use shift_glyph_codec::OutlineCommand;
use shift_slug::{AtlasBuilder, DEFAULT_BAND_COUNT};
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    FontRef, GlyphId, MetadataProvider, Tag,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Default)]
struct CommandPen(Vec<OutlineCommand<f32>>);

impl OutlinePen for CommandPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push(OutlineCommand::Move { x, y });
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push(OutlineCommand::Line { x, y });
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.0.push(OutlineCommand::Quad { cx, cy, x, y });
    }

    fn curve_to(&mut self, c1x: f32, c1y: f32, c2x: f32, c2y: f32, x: f32, y: f32) {
        self.0.push(OutlineCommand::Cubic {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
        });
    }

    fn close(&mut self) {
        self.0.push(OutlineCommand::Close);
    }
}

struct Arguments {
    path: PathBuf,
    band_count: u32,
    settings: Vec<(Tag, f32)>,
}

fn main() -> Result<()> {
    let arguments = arguments()?;
    let read_started = Instant::now();
    let bytes = fs::read(&arguments.path)?;
    let read_elapsed = read_started.elapsed();
    let font = FontRef::new(&bytes)?;
    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let glyph_count = u32::from(metrics.glyph_count);
    let location = font.axes().location(arguments.settings.iter().copied());
    let outlines = font.outline_glyphs();
    let mut builder = AtlasBuilder::new(arguments.band_count)?;

    let build_started = Instant::now();
    for glyph_id in 0..glyph_count {
        let glyph_id = GlyphId::new(glyph_id);
        let mut pen = CommandPen::default();
        if let Some(outline) = outlines.get(glyph_id) {
            outline.draw(
                DrawSettings::unhinted(Size::unscaled(), &location),
                &mut pen,
            )?;
        }
        builder.add_glyph(pen.0)?;
    }
    let atlas = builder.finish();
    let build_elapsed = build_started.elapsed();
    let statistics = atlas.statistics();
    let layout = atlas.layout(256)?;
    let mut occupancies: Vec<_> = atlas.bands().iter().map(|band| band.count).collect();
    occupancies.sort_unstable();
    let count_over_u8 = occupancies
        .iter()
        .filter(|count| **count > u8::MAX.into())
        .count();
    let offset_over_24 = atlas
        .bands()
        .iter()
        .filter(|band| band.start > 0x00ff_ffff)
        .count();

    println!("source={}", arguments.path.display());
    println!(
        "source_bytes={} read_ms={:.3} glyphs={} bands_per_direction={}",
        bytes.len(),
        read_elapsed.as_secs_f64() * 1_000.0,
        statistics.glyph_count,
        statistics.bands_per_direction,
    );
    println!(
        "build_ms={:.3} curves={} curve_indices={} max_curves_per_glyph={}",
        build_elapsed.as_secs_f64() * 1_000.0,
        statistics.curve_count,
        statistics.curve_index_count,
        statistics.max_curves_per_glyph,
    );
    println!(
        "band_occupancy_p50={} p95={} p99={} max={} count_over_255={} offsets_over_24bit={}",
        percentile(&occupancies, 0.50),
        percentile(&occupancies, 0.95),
        percentile(&occupancies, 0.99),
        statistics.max_band_occupancy,
        count_over_u8,
        offset_over_24,
    );
    println!(
        "gpu_bytes={} curves={} indices={} glyphs={} bands={}",
        layout.total_length,
        layout.curves.length,
        layout.curve_indices.length,
        layout.glyphs.length,
        layout.bands.length,
    );

    Ok(())
}

fn arguments() -> Result<Arguments> {
    let mut values = env::args().skip(1);
    let path = values
        .next()
        .map(PathBuf::from)
        .ok_or("usage: analyze_font FONT [--bands COUNT] [TAG=VALUE ...]")?;
    let mut band_count = DEFAULT_BAND_COUNT;
    let mut settings = Vec::new();

    while let Some(value) = values.next() {
        if value == "--bands" {
            band_count = values.next().ok_or("--bands requires a count")?.parse()?;
            continue;
        }
        settings.push(parse_setting(&value)?);
    }

    Ok(Arguments {
        path,
        band_count,
        settings,
    })
}

fn parse_setting(value: &str) -> Result<(Tag, f32)> {
    let (tag, coordinate) = value
        .split_once('=')
        .ok_or("axis setting must have TAG=VALUE form")?;
    let tag: [u8; 4] = tag
        .as_bytes()
        .try_into()
        .map_err(|_| "axis tag must contain exactly four ASCII bytes")?;

    Ok((Tag::new(&tag), coordinate.parse()?))
}

fn percentile(values: &[u32], quantile: f64) -> u32 {
    if values.is_empty() {
        return 0;
    }
    values[((values.len() - 1) as f64 * quantile).round() as usize]
}

use std::{
    env, fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use shift_backends::{ImportBatchLimit, font_loader::FontLoader};
use shift_store::{ShiftStore, WorkspaceState};
use shift_workspace::{AcquireScope, FontWorkspace, stream_into};

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let batch_glyphs = env::var("SHIFT_IMPORT_BATCH_GLYPHS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(512);
    let batch_layers = env::var("SHIFT_IMPORT_BATCH_LAYERS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1_024);
    let batch_limit = ImportBatchLimit::new(batch_glyphs, batch_layers);
    let progress_batches = env::var("SHIFT_IMPORT_PROGRESS_BATCHES")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(32);

    let source = PathBuf::from(env::args_os().nth(1).ok_or("missing source path")?);
    let store_path = PathBuf::from(env::args_os().nth(2).ok_or("missing store path")?);
    let _ = fs::remove_file(&store_path);
    let source_str = source.to_str().ok_or("invalid source path")?;
    let total_started = Instant::now();

    let started = Instant::now();
    let import = FontLoader::new().stream_font(source_str)?;
    println!("directory_ms={:.3}", ms(started.elapsed()));
    let started = Instant::now();
    let directory = import.directory();
    println!("publish_directory_ms={:.3}", ms(started.elapsed()));
    println!("declared_glyph_count={}", import.glyph_count());
    println!("published_glyph_count={}", directory.len());
    drop(directory);
    println!("batch_glyph_limit={batch_glyphs}");
    println!("batch_layer_limit={batch_layers}");
    println!("progress_batch_interval={progress_batches}");

    let started = Instant::now();
    let mut store = ShiftStore::open_for_import(&store_path)?;
    let mut writer = store.font_stream_writer(import.header())?;
    println!("store_setup_ms={:.3}", ms(started.elapsed()));

    let pipeline_started = Instant::now();
    let mut parse = Duration::ZERO;
    let mut pack = Duration::ZERO;
    let mut compression = Duration::ZERO;
    let mut sqlite = Duration::ZERO;
    let mut glyph_count = 0;
    let mut layer_count = 0;
    let mut batches = 0;
    stream_into(import, &mut writer, batch_limit, |batch| {
        parse += batch.parse_elapsed;
        pack += batch.pack_elapsed;
        compression += batch.compression_elapsed;
        sqlite += batch.sqlite_elapsed;
        glyph_count += batch.glyph_count;
        layer_count += batch.layer_count;
        batches += 1;

        if batches % progress_batches == 0 {
            let wall = pipeline_started.elapsed();
            println!(
                "progress batches={batches} glyphs={glyph_count} layers={layer_count} parse_ms={:.3} pack_ms={:.3} compression_ms={:.3} sqlite_ms={:.3} wall_ms={:.3} glyphs_per_sec={:.1}",
                ms(parse),
                ms(pack),
                ms(compression),
                ms(sqlite),
                ms(wall),
                glyph_count as f64 / wall.as_secs_f64()
            );
        }
    })?;
    println!("parse_ms={:.3}", ms(parse));
    println!("pack_ms={:.3}", ms(pack));
    println!("compression_ms={:.3}", ms(compression));
    println!("sqlite_ms={:.3}", ms(sqlite));
    println!("pipeline_wall_ms={:.3}", ms(pipeline_started.elapsed()));
    println!("batch_count={batches}");
    println!("glyph_count={glyph_count}");
    println!("streamed_layer_count={layer_count}");

    let started = Instant::now();
    writer.finish()?;
    println!("commit_ms={:.3}", ms(started.elapsed()));
    let started = Instant::now();
    store.finish_import()?;
    println!("finalize_import_ms={:.3}", ms(started.elapsed()));
    store.set_workspace_state(WorkspaceState::imported(&source, None))?;

    let started = Instant::now();
    let directory = store.load_font_directory()?;
    println!("materialize_directory_ms={:.3}", ms(started.elapsed()));
    println!("foreign_import_ms={:.3}", ms(total_started.elapsed()));
    println!("materialized_glyph_count={}", directory.glyph_count());
    println!("store_bytes={}", fs::metadata(&store_path)?.len());
    let started = Instant::now();
    let layer_directory = store.list_glyph_layer_directory()?;
    println!("layer_count={}", layer_directory.len());
    println!(
        "packed_bytes={}",
        layer_directory
            .iter()
            .map(|entry| entry.decoded_byte_length)
            .sum::<u64>()
    );
    println!(
        "stored_payload_bytes={}",
        layer_directory
            .iter()
            .map(|entry| entry.stored_byte_length)
            .sum::<u64>()
    );
    println!("inspection_ms={:.3}", ms(started.elapsed()));
    drop(directory);
    drop(store);

    let started = Instant::now();
    let mut workspace = FontWorkspace::resume(&store_path)?;
    println!("native_resume_ms={:.3}", ms(started.elapsed()));
    println!("resumed_glyph_count={}", workspace.font().glyph_count());
    println!("resumed_loaded_layers={}", workspace.loaded_layer_count());
    let first_glyph_id = workspace
        .font()
        .glyph_id_by_name(".notdef")
        .or_else(|| workspace.font().glyphs().next().map(|glyph| glyph.id()));
    if let Some(glyph_id) = first_glyph_id {
        let layer_ids = workspace
            .font()
            .glyph(glyph_id.clone())
            .unwrap()
            .layers()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let started = Instant::now();
        workspace.acquire_glyphs(std::slice::from_ref(&glyph_id), AcquireScope::Glyphs)?;
        println!("one_glyph_acquire_ms={:.3}", ms(started.elapsed()));
        println!("one_glyph_loaded_layers={}", workspace.loaded_layer_count());

        let probe_store = ShiftStore::open(&store_path)?;
        let started = Instant::now();
        let layers = probe_store.load_glyph_layers(&layer_ids)?;
        println!("one_glyph_batch_decode_ms={:.3}", ms(started.elapsed()));
        let mut probe_font = workspace.font().clone();
        let started = Instant::now();
        probe_font.replace_glyph_layers(layers)?;
        println!("one_glyph_install_ms={:.3}", ms(started.elapsed()));

        let started = Instant::now();
        workspace.evict_glyphs(&[glyph_id])?;
        println!("one_glyph_evict_ms={:.3}", ms(started.elapsed()));
    }
    Ok(())
}

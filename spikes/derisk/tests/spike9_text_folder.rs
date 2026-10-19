//! Spike 9: can `.shift` be a folder of per-glyph text files without
//! bottlenecking saves?
//!
//! The working store stays SQLite. This measures only the folder side on real
//! fonts: the one-time full write (conversion, or first open on a new machine),
//! incremental saves of N changed glyphs, a full parse back, a stat scan, and
//! kerning. Every write is the crash-safe path: temp file, fsync, rename, then
//! one directory fsync.
//!
//! Run with `cargo test --release --test spike9_text_folder -- --ignored --nocapture`.

use std::fmt::Write as _;
use std::fs::{self, File};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use shift_font::{Font, Glyph};
use shift_workspace::FontWorkspace;

const THREADS: usize = 8;

fn json<T: serde::Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_string(value).unwrap()
}

/// One glyph file: pretty structure, one point per line.
fn glyph_text(glyph: &Glyph) -> String {
    let mut out = String::new();
    let unicodes: Vec<String> = glyph.unicodes().iter().map(|u| format!("{u:04X}")).collect();
    writeln!(out, "{{\n  \"id\": {},\n  \"name\": {},\n  \"unicodes\": {},\n  \"layers\": {{", json(&glyph.id().to_string()), json(glyph.name()), json(&unicodes)).unwrap();
    let mut layers: Vec<_> = glyph.layers().values().collect();
    layers.sort_by_key(|layer| layer.id().to_string());
    for (li, layer) in layers.iter().enumerate() {
        writeln!(out, "    {}: {{\n      \"source\": {},\n      \"advance\": {},\n      \"contours\": [", json(&layer.id().to_string()), json(&layer.source_id().to_string()), json(&layer.width())).unwrap();
        let contours: Vec<_> = layer.contours_iter().collect();
        for (ci, contour) in contours.iter().enumerate() {
            writeln!(out, "        {{ \"id\": {}, \"closed\": {}, \"points\": [", json(&contour.id().to_string()), contour.is_closed()).unwrap();
            let points = contour.points();
            for (pi, point) in points.iter().enumerate() {
                let comma = if pi + 1 < points.len() { "," } else { "" };
                writeln!(out, "          [{}, {}, {}, \"{:?}\", {}]{comma}", json(&point.id().to_string()), json(&point.x()), json(&point.y()), point.point_type(), point.is_smooth()).unwrap();
            }
            let comma = if ci + 1 < contours.len() { "," } else { "" };
            writeln!(out, "        ] }}{comma}").unwrap();
        }
        out.push_str("      ],\n      \"components\": [\n");
        let components: Vec<_> = layer.components_iter().collect();
        for (i, component) in components.iter().enumerate() {
            let comma = if i + 1 < components.len() { "," } else { "" };
            writeln!(out, "        {{ \"id\": {}, \"base\": {}, \"transform\": {}, \"alignment\": \"{:?}\" }}{comma}", json(&component.id().to_string()), json(&component.base_glyph_id().to_string()), json(&component.transform().to_values().to_vec()), component.alignment()).unwrap();
        }
        out.push_str("      ],\n      \"anchors\": [\n");
        let anchors: Vec<_> = layer.anchors_iter().collect();
        for (i, anchor) in anchors.iter().enumerate() {
            let comma = if i + 1 < anchors.len() { "," } else { "" };
            writeln!(out, "        {{ \"id\": {}, \"name\": {}, \"x\": {}, \"y\": {} }}{comma}", json(&anchor.id().to_string()), json(&anchor.name()), json(&anchor.x()), json(&anchor.y())).unwrap();
        }
        let comma = if li + 1 < layers.len() { "," } else { "" };
        writeln!(out, "      ]\n    }}{comma}").unwrap();
    }
    out.push_str("  }\n}\n");
    out
}

/// One line per pair per source: `source first second value`.
fn kerning_text(font: &Font) -> (String, usize) {
    let mut out = String::new();
    let mut pairs = 0;
    for (source, kerning) in font.kerning().sources() {
        for (pair, value) in kerning.pairs() {
            writeln!(out, "{source} {:?} {:?} {value}", pair.first, pair.second).unwrap();
            pairs += 1;
        }
    }
    (out, pairs)
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8], fsync: bool) {
    let tmp = dir.join(format!(".{name}.tmp"));
    let mut file = File::create(&tmp).unwrap();
    file.write_all(bytes).unwrap();
    if fsync {
        file.sync_all().unwrap();
    }
    fs::rename(&tmp, dir.join(name)).unwrap();
}

/// One filesystem-wide barrier instead of a per-file fsync. Safe here because
/// the working store holds the truth and the `.syncing` marker covers the window.
fn barrier(dir: &Path) {
    let file = File::open(dir).unwrap();
    use std::os::fd::AsRawFd;
    assert_eq!(unsafe { libc::syncfs(file.as_raw_fd()) }, 0);
}

fn sync_dir(dir: &Path) {
    File::open(dir).unwrap().sync_all().unwrap();
}

/// Serializes and writes `glyphs` in parallel; returns (serialize, write) wall times and bytes.
fn write_glyphs(dir: &Path, glyphs: &[&Glyph], fsync: bool) -> (Duration, Duration, usize) {
    let start = Instant::now();
    let texts: Vec<(String, String)> = std::thread::scope(|scope| {
        let chunk = glyphs.len().div_ceil(THREADS).max(1);
        let handles: Vec<_> = glyphs
            .chunks(chunk)
            .map(|part| scope.spawn(move || part.iter().map(|g| (format!("{}.json", g.id()), glyph_text(g))).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap()).collect()
    });
    let serialize = start.elapsed();
    let bytes = texts.iter().map(|(_, t)| t.len()).sum();
    let start = Instant::now();
    std::thread::scope(|scope| {
        let chunk = texts.len().div_ceil(THREADS).max(1);
        for part in texts.chunks(chunk) {
            scope.spawn(move || {
                for (name, text) in part {
                    write_atomic(dir, name, text.as_bytes(), fsync);
                }
            });
        }
    });
    if fsync {
        sync_dir(dir);
    }
    (serialize, start.elapsed(), bytes)
}

fn read_all(dir: &Path) -> (Duration, Duration, usize) {
    let start = Instant::now();
    let paths: Vec<PathBuf> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    let mut total_size = 0u64;
    for path in &paths {
        let meta = fs::metadata(path).unwrap();
        total_size += meta.len();
        let _ = meta.modified().unwrap();
    }
    let stat = start.elapsed();
    let start = Instant::now();
    std::thread::scope(|scope| {
        let chunk = paths.len().div_ceil(THREADS).max(1);
        for part in paths.chunks(chunk) {
            scope.spawn(move || {
                for path in part {
                    let bytes = fs::read(path).unwrap();
                    let _: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                }
            });
        }
    });
    (stat, start.elapsed(), total_size as usize)
}

fn ms(d: Duration) -> String {
    format!("{:.1} ms", d.as_secs_f64() * 1000.0)
}

fn bench(label: &str, path: &str) {
    let store_dir = tempfile::tempdir().unwrap();
    let start = Instant::now();
    let mut workspace = FontWorkspace::open(path, store_dir.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let import = start.elapsed();
    let font = workspace.font();
    let glyphs: Vec<&Glyph> = font.glyphs().collect();
    let layers: usize = glyphs.iter().map(|g| g.layers().len()).sum();
    eprintln!("\n== {label}: {} glyphs, {layers} layers (import + load all {})", glyphs.len(), ms(import));

    let root = tempfile::tempdir_in(std::env::var("SPIKE_DIR").unwrap_or_else(|_| std::env::temp_dir().display().to_string())).unwrap();
    let dir = root.path().join("glyphs");
    fs::create_dir(&dir).unwrap();

    let (ser, write, bytes) = write_glyphs(&dir, &glyphs, false);
    eprintln!("full write, no fsync     serialize {}  write {}  {:.1} MB", ms(ser), ms(write), bytes as f64 / 1e6);
    let (ser, write, _) = write_glyphs(&dir, &glyphs, true);
    eprintln!("full write, fsync        serialize {}  write {}", ms(ser), ms(write));

    for n in [1usize, 10, 100, 1000] {
        if n > glyphs.len() {
            break;
        }
        let step = glyphs.len() / n;
        let changed: Vec<&Glyph> = glyphs.iter().step_by(step.max(1)).take(n).copied().collect();
        let mut best = Duration::MAX;
        for _ in 0..3 {
            let start = Instant::now();
            write_glyphs(&dir, &changed, true);
            best = best.min(start.elapsed());
        }
        eprintln!("incremental save {n:>4} glyphs (fsync, best of 3): {}", ms(best));
    }

    let start = Instant::now();
    write_atomic(root.path(), ".syncing", b"1", true);
    write_glyphs(&dir, &glyphs, false);
    barrier(&dir);
    fs::remove_file(root.path().join(".syncing")).unwrap();
    sync_dir(root.path());
    eprintln!("full write, marker + one barrier (no per-file fsync): {}", ms(start.elapsed()));
    for n in [1usize, 100, 1000] {
        if n > glyphs.len() {
            break;
        }
        let changed: Vec<&Glyph> = glyphs.iter().step_by((glyphs.len() / n).max(1)).take(n).copied().collect();
        let mut best = Duration::MAX;
        for _ in 0..3 {
            let start = Instant::now();
            write_atomic(root.path(), ".syncing", b"1", true);
            write_glyphs(&dir, &changed, false);
            barrier(&dir);
            fs::remove_file(root.path().join(".syncing")).unwrap();
            sync_dir(root.path());
            best = best.min(start.elapsed());
        }
        eprintln!("incremental save {n:>4} glyphs (marker + barrier, best of 3): {}", ms(best));
    }

    let start = Instant::now();
    write_atomic(root.path(), ".syncing", b"1", true);
    fs::remove_file(root.path().join(".syncing")).unwrap();
    sync_dir(root.path());
    eprintln!("mid-sync marker create + remove: {}", ms(start.elapsed()));

    let (stat, parse, size) = read_all(&dir);
    eprintln!("stat scan {}  parse all (8 threads) {}  on disk {:.1} MB", ms(stat), ms(parse), size as f64 / 1e6);

    let start = Instant::now();
    let (kerning, pairs) = kerning_text(font);
    let ser = start.elapsed();
    let start = Instant::now();
    write_atomic(root.path(), "kerning.txt", kerning.as_bytes(), true);
    if let Ok(keep) = std::env::var("SPIKE_KEEP") {
        if label.contains(&keep) {
            eprintln!("kept {}", root.keep().display());
        }
    }
    eprintln!("kerning: {pairs} pairs, {:.1} MB, serialize {} write {}", kerning.len() as f64 / 1e6, ms(ser), ms(start.elapsed()));
}

#[test]
#[ignore = "imports large fonts; run with --ignored"]
fn text_folder_costs_on_real_fonts() {
    bench("MutatorSans", concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace"));
    bench("Roboto Flex", "/home/kostyafarber/repos/designspace-stress/roboto-flex/sources/RobotoFlex.designspace");
    bench("Noto Sans CJK SC", "/home/kostyafarber/repos/rumil-core-or-tex/.cache/src/RaTeX/scripts/fonts/NotoSansCJKsc-Regular.otf");
}

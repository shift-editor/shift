//! Phase b of the boundary-protocol plan: what the engine's synchronous store
//! reads cost on a large document. Throwaway; not product code.
//!
//! bench <doc.shift> <composites.shift> <indexed.shift> <out dir>
#![allow(clippy::print_stdout, clippy::unwrap_used)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::{Duration, Instant};

use rusqlite::{Connection, params_from_iter};
use shift_backends::GlyphCategories;
use shift_font::{GlyphCategory, GlyphSubcategory, LayerId};
use shift_store::{ShiftStore, StoreReader};

struct Counting;
static LIVE: AtomicIsize = AtomicIsize::new(0);
#[allow(unsafe_code)]
// SAFETY: forwards to the system allocator and only counts sizes.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size() as isize, Ordering::Relaxed);
        // SAFETY: same contract as the caller's.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size() as isize, Ordering::Relaxed);
        // SAFETY: same contract as the caller's.
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
        LIVE.fetch_add(new as isize - layout.size() as isize, Ordering::Relaxed);
        // SAFETY: same contract as the caller's.
        unsafe { System.realloc(ptr, layout, new) }
    }
}
#[global_allocator]
static GLOBAL: Counting = Counting;

fn live() -> isize {
    LIVE.load(Ordering::Relaxed)
}

struct Stats {
    n: usize,
    median: f64,
    p95: f64,
    min: f64,
}

fn stats(mut samples: Vec<Duration>) -> Stats {
    samples.sort();
    let ms = |d: Duration| d.as_secs_f64() * 1e3;
    let n = samples.len();
    let p95 = ((n as f64 * 0.95).ceil() as usize).clamp(1, n) - 1;
    Stats {
        n,
        median: ms(samples[n / 2]),
        p95: ms(samples[p95]),
        min: ms(samples[0]),
    }
}

struct Report {
    out: String,
}

impl Report {
    fn heading(&mut self, title: &str) {
        let _ = write!(
            self.out,
            "\n### {title}\n\n| Measure | median (ms) | p95 (ms) | min (ms) | n |\n|---|---|---|---|---|\n"
        );
        println!("\n== {title}");
    }
    fn row(&mut self, label: &str, s: &Stats) {
        let _ = writeln!(
            self.out,
            "| {label} | {:.3} | {:.3} | {:.3} | {} |",
            s.median, s.p95, s.min, s.n
        );
        println!(
            "{label:<70} median {:>9.3} ms  p95 {:>9.3}  min {:>9.3}  n {}",
            s.median, s.p95, s.min, s.n
        );
    }
    fn note(&mut self, text: &str) {
        let _ = writeln!(self.out, "\n{text}\n");
        println!("{text}");
    }
}

const COLD_RUNS: usize = 15;
const WARM_RUNS: usize = 200;

/// A fresh reader, as the preload opens one: new connection, empty SQLite page cache.
/// The OS file cache stays warm (purging it needs root).
fn reader(doc: &Path, recovery: &Path) -> StoreReader {
    StoreReader::open_document(doc, recovery).unwrap()
}

/// `f` cold (first call on a fresh reader, `COLD_RUNS` readers) and warm (same reader).
fn cold_warm(
    report: &mut Report,
    label: &str,
    doc: &Path,
    recovery: &Path,
    mut f: impl FnMut(&StoreReader, usize),
) {
    let mut cold = Vec::new();
    for i in 0..COLD_RUNS {
        let r = reader(doc, recovery);
        let t = Instant::now();
        f(&r, i);
        cold.push(t.elapsed());
    }
    let r = reader(doc, recovery);
    for i in 0..20 {
        f(&r, i);
    }
    let mut warm = Vec::new();
    for i in 0..WARM_RUNS {
        let t = Instant::now();
        f(&r, i);
        warm.push(t.elapsed());
    }
    report.row(&format!("{label} — cold"), &stats(cold));
    report.row(&format!("{label} — warm"), &stats(warm));
}

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

fn strings(conn: &Connection, sql: &str, args: &[String]) -> Vec<(String, String)> {
    let mut stmt = conn.prepare_cached(sql).unwrap();
    stmt.query_map(params_from_iter(args), |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// The derived record fields decision 1 has the engine ask for: name, unicodes,
/// stored category overrides, component bases, then mark / nonspacing / ligature.
#[derive(Debug)]
#[allow(dead_code)]
struct Derived {
    id: String,
    name: String,
    unicodes: Vec<u32>,
    bases: BTreeSet<String>,
    mark: bool,
    nonspacing_mark: bool,
    ligature: bool,
}

fn derived_fields(
    conn: &Connection,
    categories: &GlyphCategories,
    ids: &[String],
    rename: Option<&str>,
) -> Vec<Derived> {
    let mut out = Vec::new();
    for chunk in ids.chunks(10_000) {
        let ph = placeholders(chunk.len());
        let mut glyphs: BTreeMap<String, (String, Option<String>, Option<String>)> =
            BTreeMap::new();
        {
            let mut stmt = conn
                .prepare_cached(&format!(
                    "SELECT id, name, category, sub_category FROM glyphs WHERE id IN ({ph})"
                ))
                .unwrap();
            let rows = stmt
                .query_map(params_from_iter(chunk), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .unwrap();
            for row in rows {
                let (id, name, category, sub) = row.unwrap();
                glyphs.insert(id, (name, category, sub));
            }
        }
        let mut unicodes: BTreeMap<String, Vec<u32>> = BTreeMap::new();
        {
            let mut stmt = conn
                .prepare_cached(&format!(
                    "SELECT glyph_id, unicode FROM glyph_unicodes WHERE glyph_id IN ({ph}) ORDER BY glyph_id, order_index"
                ))
                .unwrap();
            let rows = stmt
                .query_map(params_from_iter(chunk), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
                })
                .unwrap();
            for row in rows {
                let (id, u) = row.unwrap();
                unicodes.entry(id).or_default().push(u);
            }
        }
        let layer_owner: BTreeMap<String, String> = strings(
            conn,
            &format!("SELECT id, glyph_id FROM glyph_layers WHERE glyph_id IN ({ph})"),
            chunk,
        )
        .into_iter()
        .collect();
        let mut bases: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (layer, base) in strings(
            conn,
            &format!(
                "SELECT c.layer_id, c.base_glyph_id FROM glyph_components AS c \
                 WHERE c.layer_id IN (SELECT l.id FROM glyph_layers AS l WHERE l.glyph_id IN ({ph}))"
            ),
            chunk,
        ) {
            if let Some(owner) = layer_owner.get(&layer) {
                bases.entry(owner.clone()).or_default().insert(base);
            }
        }
        for (id, (name, category, sub)) in glyphs {
            let name = rename.map_or(name, str::to_owned);
            let unicodes = unicodes.remove(&id).unwrap_or_default();
            let looked_up = categories.lookup(&name, &unicodes);
            let category = category
                .and_then(|c| c.parse::<GlyphCategory>().ok())
                .or(looked_up.category);
            let sub = sub
                .and_then(|c| c.parse::<GlyphSubcategory>().ok())
                .or(looked_up.sub_category);
            out.push(Derived {
                bases: bases.remove(&id).unwrap_or_default(),
                mark: category == Some(GlyphCategory::Mark),
                nonspacing_mark: category == Some(GlyphCategory::Mark)
                    && sub == Some(GlyphSubcategory::Nonspacing),
                ligature: sub == Some(GlyphSubcategory::Ligature),
                id,
                name,
                unicodes,
            });
        }
    }
    out
}

fn column(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn plan(conn: &Connection, sql: &str) -> String {
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
    let rows: Vec<(i64, i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut depth: BTreeMap<i64, usize> = BTreeMap::new();
    let mut out = String::new();
    for (id, parent, detail) in rows {
        let d = depth.get(&parent).map_or(0, |d| d + 1);
        depth.insert(id, d);
        let _ = writeln!(out, "{}{detail}", "  ".repeat(d));
    }
    out
}

/// Opens `doc` as the workspace does, so its recovery store exists for readers.
fn writer(doc: &Path, recovery: &Path) -> ShiftStore {
    ShiftStore::open_document_with_recovery(doc, recovery).unwrap()
}

fn main() {
    let args: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    let (doc, composites, indexed, out_dir) = (&args[0], &args[1], &args[2], &args[3]);
    let tmp = std::env::temp_dir().join(format!("boundary-bench-run-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let rec = tmp.join("doc.recovery");
    let rec_c = tmp.join("composites.recovery");
    let rec_i = tmp.join("indexed.recovery");
    let mut report = Report { out: String::new() };

    // ---------------- A. directory memory and paged records ----------------
    report.heading("A1. Engine directory today (native, 64-bit)");
    let mut load = Vec::new();
    let mut session_open = Vec::new();
    let mut live_bytes = Vec::new();
    for _ in 0..5 {
        let store = writer(doc, &rec);
        let before = live();
        let t = Instant::now();
        let font = store.load_font_directory().unwrap();
        load.push(t.elapsed());
        let t = Instant::now();
        let session = shift_engine::EngineSession::open_directory(font);
        session_open.push(t.elapsed());
        live_bytes.push(live() - before);
        drop(session);
        drop(store);
    }
    report.row("load_font_directory (store read)", &stats(load));
    report.row("EngineSession::open_directory", &stats(session_open));
    live_bytes.sort();
    report.note(&format!(
        "Directory + session live heap after open: median {:.1} MB (runs: {:?} MB). Native 64-bit; the wasm32 engine's is smaller per pointer.",
        live_bytes[2] as f64 / 1e6,
        live_bytes
            .iter()
            .map(|b| (*b as f64 / 1e5).round() / 10.0)
            .collect::<Vec<_>>()
    ));

    let _keep = writer(doc, &rec);
    let categories_new = {
        let mut v = Vec::new();
        for _ in 0..5 {
            let t = Instant::now();
            let c = GlyphCategories::new();
            v.push(t.elapsed());
            drop(c);
        }
        stats(v)
    };
    let before = live();
    let categories = GlyphCategories::new();
    let categories_bytes = live() - before;

    report.heading("A2. Paged glyph records from SQLite (merged recovery views, keyset by name)");
    for page in [256usize, 1024, 4096] {
        let mut totals = Vec::new();
        let mut pages = Vec::new();
        let mut count = 0;
        for run in 0..6 {
            let r = reader(doc, &rec);
            let conn = r.connection();
            let t_total = Instant::now();
            let mut after = String::new();
            count = 0;
            loop {
                let t = Instant::now();
                let ids = {
                    let mut stmt = conn
                        .prepare_cached(
                            "SELECT id, name FROM glyphs WHERE name > ?1 ORDER BY name LIMIT ?2",
                        )
                        .unwrap();
                    stmt.query_map(rusqlite::params![after, page as i64], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .unwrap()
                    .map(Result::unwrap)
                    .collect::<Vec<_>>()
                };
                if ids.is_empty() {
                    break;
                }
                after = ids.last().unwrap().1.clone();
                let id_list: Vec<String> = ids.into_iter().map(|(id, _)| id).collect();
                let records = derived_fields(conn, &categories, &id_list, None);
                // Layers per record (id, source, width), as GlyphRecord carries them.
                let layers = {
                    let ph = placeholders(id_list.len());
                    let mut stmt = conn
                        .prepare_cached(&format!(
                            "SELECT id, glyph_id, source_id, width, height FROM glyph_layers WHERE glyph_id IN ({ph})"
                        ))
                        .unwrap();
                    stmt.query_map(params_from_iter(&id_list), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, f64>(3)?,
                            row.get::<_, Option<f64>>(4)?,
                        ))
                    })
                    .unwrap()
                    .count()
                };
                assert_eq!(records.len(), layers);
                count += records.len();
                if run > 0 {
                    pages.push(t.elapsed());
                }
            }
            if run > 0 {
                totals.push(t_total.elapsed());
            }
        }
        assert_eq!(count, 65_535);
        report.row(&format!("page of {page}: one page"), &stats(pages));
        report.row(
            &format!("page of {page}: all {count} records (fresh reader each run)"),
            &stats(totals),
        );
    }
    {
        let r = reader(doc, &rec);
        report.note(&format!(
            "Page query plan (merged views):\n\n```\n{}```",
            plan(
                r.connection(),
                "SELECT id, name FROM glyphs WHERE name > 'a' ORDER BY name LIMIT 1024"
            )
        ));
    }

    // ---------------- B. decision 1: derived fields per edit ----------------
    report.heading("B. Decision 1: derived fields the engine asks for, per edit");
    report.row("GlyphCategories::new() (once per reader)", &categories_new);
    report.note(&format!(
        "GlyphCategories live heap: {:.1} MB (glyph data is static in the binary).",
        categories_bytes as f64 / 1e6
    ));
    let _keep_c = writer(composites, &rec_c);
    let sample_ids = {
        let r = reader(doc, &rec);
        column(r.connection(), "SELECT id FROM glyphs ORDER BY order_index")
    };
    let pick = |i: usize| sample_ids[(i * 7919 + 13) % sample_ids.len()].clone();
    cold_warm(
        &mut report,
        "rename: derived fields of the renamed glyph (1 glyph)",
        doc,
        &rec,
        |r, i| {
            let d = derived_fields(r.connection(), &categories, &[pick(i)], Some("uni4E00.alt"));
            assert_eq!(d.len(), 1);
        },
    );
    // Synthetic composites (CJK SC has none): bases bench_base_N with N dependents.
    let bases: Vec<(usize, String, String, Vec<String>)> = {
        let r = reader(composites, &rec_c);
        let conn = r.connection();
        [10usize, 100, 1000, 10_000]
            .into_iter()
            .map(|n| {
                let (base, layer): (String, String) = conn
                    .query_row(
                        "SELECT base_glyph_id, (SELECT id FROM glyph_layers WHERE glyph_id = base_glyph_id) \
                         FROM glyph_components WHERE id LIKE ?1 LIMIT 1",
                        [format!("bench-{n}-%")],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                let deps = column(
                    conn,
                    &format!(
                        "SELECT glyph_id FROM glyph_layers WHERE id IN (SELECT layer_id FROM glyph_components WHERE id LIKE 'bench-{n}-%')"
                    ),
                );
                assert_eq!(deps.len(), n);
                (n, base, layer, deps)
            })
            .collect()
    };
    let (_, _, _, deps10) = &bases[0];
    cold_warm(
        &mut report,
        "add/remove component: derived fields of the composite (1 glyph)",
        composites,
        &rec_c,
        |r, i| {
            let d = derived_fields(r.connection(), &categories, &[deps10[i % deps10.len()].clone()], None);
            assert_eq!(d[0].bases.len(), 1);
        },
    );
    cold_warm(
        &mut report,
        "add/remove component: component closure of the composite (load planning)",
        composites,
        &rec_c,
        |r, i| {
            let id = deps10[i % deps10.len()].parse().unwrap();
            assert_eq!(r.referenced_glyph_closure([id]).unwrap().len(), 2);
        },
    );
    for (n, _base, layer, _deps) in &bases {
        let layer: LayerId = layer.parse().unwrap();
        cold_warm(
            &mut report,
            &format!("base edit, {n} dependents: dependents(base layer)"),
            composites,
            &rec_c,
            |r, _| assert_eq!(r.dependent_glyph_ids_for_layers(&[layer]).unwrap().len(), *n),
        );
        cold_warm(
            &mut report,
            &format!("base edit, {n} dependents: dependents + their derived fields"),
            composites,
            &rec_c,
            |r, _| {
                let deps: Vec<String> = r
                    .dependent_glyph_ids_for_layers(&[layer])
                    .unwrap()
                    .iter()
                    .map(ToString::to_string)
                    .collect();
                assert_eq!(derived_fields(r.connection(), &categories, &deps, None).len(), *n);
            },
        );
    }
    {
        let r = reader(composites, &rec_c);
        let conn = r.connection();
        report.note(&format!(
            "Derived-fields query plans (merged views):\n\n```\n-- glyph rows\n{}-- unicodes\n{}-- layers\n{}-- dependents (shift-store)\n{}-- component bases\n{}```",
            plan(conn, "SELECT id, name, category, sub_category FROM glyphs WHERE id IN ('a','b')"),
            plan(conn, "SELECT glyph_id, unicode FROM glyph_unicodes WHERE glyph_id IN ('a','b') ORDER BY glyph_id, order_index"),
            plan(conn, "SELECT id, glyph_id FROM glyph_layers WHERE glyph_id IN ('a','b')"),
            plan(conn, "SELECT DISTINCT owner.glyph_id FROM glyph_layers AS owner WHERE owner.id IN (SELECT c.layer_id FROM glyph_components AS c WHERE c.base_glyph_id IN (SELECT target.glyph_id FROM glyph_layers AS target WHERE target.id IN ('a')))"),
            plan(conn, "SELECT c.layer_id, c.base_glyph_id FROM glyph_components AS c WHERE c.layer_id IN (SELECT l.id FROM glyph_layers AS l WHERE l.glyph_id IN ('a','b'))"),
        ));
    }

    // ---------------- C. decision 2: font-level queries without a directory ----------------
    let names = {
        let r = reader(doc, &rec);
        column(r.connection(), "SELECT name FROM glyphs ORDER BY order_index")
    };
    let unicodes: Vec<String> = {
        let r = reader(doc, &rec);
        column(r.connection(), "SELECT CAST(unicode AS TEXT) FROM glyph_unicodes ORDER BY unicode")
    };
    let _keep_i = writer(indexed, &rec_i);
    type Query = (&'static str, &'static str, fn(usize, &[String], &[String], &[String]) -> Vec<String>);
    let queries: Vec<Query> = vec![
        (
            "name taken? (create / rename)",
            "SELECT 1 FROM glyphs WHERE name = ?1 LIMIT 1",
            |i, names, _, _| vec![names[(i * 7919) % names.len()].clone()],
        ),
        (
            "name free? (create / rename, miss)",
            "SELECT 1 FROM glyphs WHERE name = ?1 LIMIT 1",
            |i, _, _, _| vec![format!("bench.new.{i}")],
        ),
        (
            "next order index (create appends)",
            "SELECT MAX(order_index) FROM glyphs",
            |_, _, _, _| vec![],
        ),
        (
            "next order index, as ORDER BY DESC LIMIT 1",
            "SELECT order_index FROM glyphs ORDER BY order_index DESC LIMIT 1",
            |_, _, _, _| vec![],
        ),
        (
            "a glyph's order index (reorder)",
            "SELECT order_index FROM glyphs WHERE id = ?1",
            |i, _, ids, _| vec![ids[(i * 7919) % ids.len()].clone()],
        ),
        (
            "glyphs in an order range of 100 (reorder shifts them)",
            "SELECT id FROM glyphs WHERE order_index >= ?1 AND order_index < ?1 + 100 ORDER BY order_index",
            |i, _, _, _| vec![((i * 7919) % 65_000).to_string()],
        ),
        (
            "layers of glyph X (load planning)",
            "SELECT id, source_id FROM glyph_layers WHERE glyph_id = ?1",
            |i, _, ids, _| vec![ids[(i * 7919) % ids.len()].clone()],
        ),
        (
            "glyph with unicode U (cmap lookup)",
            "SELECT glyph_id FROM glyph_unicodes WHERE unicode = CAST(?1 AS INTEGER)",
            |i, _, _, us| vec![us[(i * 7919) % us.len()].clone()],
        ),
    ];
    for (file, recovery, title) in [
        (doc, &rec, "C. Decision 2: font-level queries, document as stored today"),
        (
            indexed,
            &rec_i,
            "C'. Decision 2: same queries with glyph_unicodes(unicode) and glyphs(order_index) indexes",
        ),
    ] {
        report.heading(title);
        let mut plans = String::new();
        for (label, sql, args) in &queries {
            let mut stmt_runs = |r: &StoreReader, i: usize| {
                let a = args(i, &names, &sample_ids, &unicodes);
                let mut stmt = r.connection().prepare_cached(sql).unwrap();
                let rows = stmt
                    .query_map(params_from_iter(&a), |row| row.get::<_, rusqlite::types::Value>(0))
                    .unwrap()
                    .count();
                std::hint::black_box(rows);
            };
            cold_warm(&mut report, label, file, recovery, &mut stmt_runs);
            let r = reader(file, recovery);
            let concrete = sql
                .replace("CAST(?1 AS INTEGER)", "19968")
                .replace("?1 + 100", "1100")
                .replace("?1", "'x'");
            let concrete = if concrete.contains("order_index >= 'x'") {
                concrete.replace("'x'", "1000")
            } else {
                concrete
            };
            let _ = write!(
                plans,
                "-- {label}\n-- merged views:\n{}-- main (canonical only):\n{}\n",
                plan(r.connection(), &concrete),
                plan(r.connection(), &concrete.replace(" glyphs", " main.glyphs").replace(" glyph_layers", " main.glyph_layers").replace(" glyph_unicodes", " main.glyph_unicodes")),
            );
        }
        report.note(&format!("Query plans:\n\n```\n{plans}```"));
    }

    std::fs::write(out_dir.join("rust-bench.md"), &report.out).unwrap();
    println!("\nwrote {}", out_dir.join("rust-bench.md").display());
}

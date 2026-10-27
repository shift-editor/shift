//! Spike: open a `.shift` document and read every glyph record, timed, natively or under WASI.
#![allow(clippy::print_stdout, clippy::unwrap_used)]

use std::time::Instant;

use shift_font::{Contour, Font, Glyph, GlyphLayer, LayerId, PointType};
use shift_store::ShiftStore;

fn synthetic_font(glyphs: usize, contours: usize, points: usize) -> Font {
    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    for glyph_index in 0..glyphs {
        let unicode = u32::try_from(glyph_index).unwrap();
        let mut glyph = Glyph::with_unicode(format!("g{glyph_index:05}"), unicode);
        let mut layer = GlyphLayer::with_width(
            LayerId::new(),
            source_id.clone(),
            500.0 + glyph_index as f64,
        );
        for contour_index in 0..contours {
            let mut contour = Contour::new();
            for point_index in 0..points {
                contour.add_point(
                    point_index as f64,
                    (glyph_index + contour_index + point_index) as f64,
                    PointType::OnCurve,
                    false,
                );
            }
            layer.add_contour(contour);
        }
        glyph.set_layer(layer);
        font.insert_glyph(glyph).unwrap();
    }
    font
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args[1].as_str() {
        "write" => {
            let glyphs: usize = args[3].parse().unwrap();
            let contours: usize = args[4].parse().unwrap();
            let points: usize = args[5].parse().unwrap();
            let t = Instant::now();
            let font = synthetic_font(glyphs, contours, points);
            println!("build_font_ms {:.1}", ms(t));
            let t = Instant::now();
            ShiftStore::create_document(&args[2], &font).unwrap();
            println!("create_document_ms {:.1}", ms(t));
        }
        "read" => {
            let (document, recovery) = (&args[2], &args[3]);
            let _ = std::fs::remove_file(recovery);
            let _ = std::fs::remove_file(format!("{recovery}-wal"));
            let _ = std::fs::remove_file(format!("{recovery}-shm"));

            // FontWorkspace::open_document: store + recovery state + directory.
            let t_total = Instant::now();
            let t = Instant::now();
            let store = ShiftStore::open_document_with_recovery(document, recovery).unwrap();
            let _state = store.recovery_state().unwrap();
            let open_store = ms(t);
            let t = Instant::now();
            let font = store.load_font_directory().unwrap();
            let directory = ms(t);
            let open = ms(t_total);

            // Bridge::get_glyphs (minus shift-backends categories): component
            // references + one record per glyph with its master layer ids.
            let t = Instant::now();
            let mut references = store.glyph_component_references().unwrap();
            let mut records = Vec::with_capacity(font.glyph_count());
            for glyph in font.glyphs() {
                let layers: Vec<LayerId> = font.master_layers(glyph).map(|l| l.id()).collect();
                let refs = references.remove(&glyph.id()).unwrap_or_default();
                records.push((glyph.name().to_string(), glyph.id(), refs, layers));
            }
            records.sort_by(|a, b| a.0.cmp(&b.0));
            let get_glyphs = ms(t);

            if args.get(4).is_some_and(|a| a == "nolayers") {
                println!(
                    "glyphs={} open_store_ms={open_store:.1} directory_ms={directory:.1} open_ms={open:.1} get_glyphs_ms={get_glyphs:.1}",
                    records.len()
                );
                return;
            }

            // Every layer's outline payload (what a full-font render pulls).
            let t = Instant::now();
            let ids: Vec<LayerId> = records.iter().flat_map(|r| r.3.iter().cloned()).collect();
            let layers = store.load_glyph_layers(&ids).unwrap();
            let points: usize = layers
                .iter()
                .map(|l| {
                    l.contours()
                        .iter()
                        .map(|c| c.1.points().len())
                        .sum::<usize>()
                })
                .sum();
            let load_layers = ms(t);

            println!(
                "glyphs={} layers={} points={} open_store_ms={open_store:.1} directory_ms={directory:.1} open_ms={open:.1} get_glyphs_ms={get_glyphs:.1} load_all_layers_ms={load_layers:.1} total_ms={:.1}",
                records.len(),
                layers.len(),
                points,
                ms(t_total)
            );
        }
        "concurrent" => {
            let (document, recovery) = (&args[2], &args[3]);
            let store = ShiftStore::open_document_with_recovery(document, recovery).unwrap();
            let font = store.load_font_directory().unwrap();
            let ids: Vec<LayerId> = font
                .glyphs()
                .flat_map(|g| font.master_layers(g).map(|l| l.id()).collect::<Vec<_>>())
                .take(1000)
                .collect();
            let t = Instant::now();
            let reader = shift_store::StoreReader::open_document(document, recovery).unwrap();
            let layers = reader.load_glyph_layers(&ids).unwrap();
            println!(
                "reader_beside_writer layers={} ms={:.1}",
                layers.len(),
                ms(t)
            );
        }
        other => panic!("unknown command {other}"),
    }
}

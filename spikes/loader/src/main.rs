//! Imports a real font with shift-backends and writes it as serialized
//! `shift_font::Font` JSON, in a fully loaded shape and a lazy-directory
//! shape (layers emptied except the first `resident` glyphs).
use shift_backends::font_loader::FontLoader;
use shift_font::{Font, LayerId};
use std::time::Instant;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("font path");
    let out = args.next().expect("output dir");
    let resident: usize = args.next().map(|s| s.parse().unwrap()).unwrap_or(300);

    let t = Instant::now();
    let font = FontLoader::new().read_font(&path).expect("read font");
    let import_ms = t.elapsed().as_secs_f64() * 1000.0;

    let layer_ids: Vec<LayerId> = font
        .glyphs()
        .skip(resident)
        .flat_map(|g| g.layers().keys().cloned().collect::<Vec<_>>())
        .collect();
    let mut lazy = font.clone();
    for id in &layer_ids {
        let layer = lazy.layer_mut(id).unwrap();
        layer.clear_contours();
        layer.clear_components();
        layer.clear_anchors();
    }

    let mut points = 0usize;
    for g in font.glyphs() {
        for l in g.layers().values() {
            for c in l.contours_iter() {
                points += c.points().len();
            }
        }
    }

    for (name, f) in [("full", &font), ("lazy", &lazy)] {
        let t = Instant::now();
        let json = serde_json::to_string(f).unwrap();
        let ser_ms = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let back: Font = serde_json::from_str(&json).unwrap();
        let de_ms = t.elapsed().as_secs_f64() * 1000.0;
        assert!(back == *f);
        std::fs::write(format!("{out}/{name}.json"), &json).unwrap();
        println!(
            "{}",
            serde_json::json!({
                "shape": name, "glyphs": f.glyph_count(), "points_full_font": points,
                "import_ms": import_ms, "json_mb": json.len() as f64 / 1e6,
                "native_serialize_ms": ser_ms, "native_deserialize_ms": de_ms,
            })
        );
    }
}

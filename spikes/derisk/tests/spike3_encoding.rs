//! SPIKE 3a: changesets as the persistence format. Sizes and encode/decode
//! times for representative edits, in postcard, MessagePack (positional and
//! named), and JSON, with a decode-equals-original check for each.

use std::time::Instant;

use engine_derisk::fixtures::{fixture, Document};
use shift_font::test_support::sample_font;
use shift_font::{
    Axis, DesignLocation, FontChangeSet, FontIntent, FontIntentSet, GlyphId, KerningPair,
    KerningValueEdit, LayerId, PointId, SourceId,
};

fn apply(font: &mut shift_font::Font, intents: Vec<FontIntent>) -> FontChangeSet {
    font.apply_intents(FontIntentSet { intents }).expect("apply").changes
}

fn time<T>(runs: u32, mut f: impl FnMut() -> T) -> (T, f64) {
    let mut out = f();
    let start = Instant::now();
    for _ in 0..runs {
        out = f();
    }
    (out, start.elapsed().as_secs_f64() * 1e6 / f64::from(runs))
}

fn report(label: &str, changes: &FontChangeSet) {
    let runs = 20;
    let mut row = format!("ENC {label:<34}");
    // postcard
    match postcard::to_allocvec(changes) {
        Ok(bytes) => {
            let (_, enc) = time(runs, || postcard::to_allocvec(changes).unwrap());
            let decoded: Result<FontChangeSet, _> = postcard::from_bytes(&bytes);
            let ok = decoded.as_ref().map(|d| d == changes).unwrap_or(false);
            let (_, dec) = time(runs, || postcard::from_bytes::<FontChangeSet>(&bytes).ok());
            row += &format!(" | postcard {:>8} B enc {enc:>7.1}µs dec {dec:>7.1}µs {}", bytes.len(), if ok { "ok" } else { "ROUNDTRIP-FAIL" });
        }
        Err(error) => row += &format!(" | postcard ERR {error}"),
    }
    for (name, named) in [("rmp", false), ("rmp-named", true)] {
        let encode = || if named { rmp_serde::to_vec_named(changes) } else { rmp_serde::to_vec(changes) };
        match encode() {
            Ok(bytes) => {
                let (_, enc) = time(runs, || encode().unwrap());
                let ok = rmp_serde::from_slice::<FontChangeSet>(&bytes).map(|d| &d == changes).unwrap_or(false);
                let (_, dec) = time(runs, || rmp_serde::from_slice::<FontChangeSet>(&bytes).ok());
                row += &format!(" | {name} {:>8} B enc {enc:>7.1}µs dec {dec:>7.1}µs {}", bytes.len(), if ok { "ok" } else { "ROUNDTRIP-FAIL" });
            }
            Err(error) => row += &format!(" | {name} ERR {error}"),
        }
    }
    let json = serde_json::to_vec(changes).unwrap();
    let ok = serde_json::from_slice::<FontChangeSet>(&json).map(|d| &d == changes).unwrap_or(false);
    let (_, dec) = time(runs, || serde_json::from_slice::<FontChangeSet>(&json).ok());
    row += &format!(" | json {:>8} B dec {dec:>8.1}µs {}", json.len(), if ok { "ok" } else { "ROUNDTRIP-FAIL" });
    eprintln!("{row}");
}

#[test]
fn changeset_encodings() {
    // Real glyph geometry from Homenaje, fully loaded.
    let document = Document::import(&fixture("Homenaje.glyphs"));
    let (_dir, mut workspace) = document.open();
    workspace.acquire_all_layers().unwrap();
    let mut font = workspace.font().clone();
    let glyph = font.glyph_by_name("O").unwrap().clone();
    let layer = glyph.layers().values().next().unwrap().clone();
    let contour = layer.contours_iter().next().unwrap().clone();
    let point: PointId = contour.points()[0].id();

    report("point move", &apply(&mut font, vec![FontIntent::MovePoints { layer_id: layer.id(), point_ids: vec![point], coords: vec![10.0, 20.0] }]));
    report(
        "contour delete",
        &apply(&mut font, vec![FontIntent::RemovePoints { layer_id: layer.id(), point_ids: contour.points().iter().map(|p| p.id()).collect() }]),
    );
    let source_id = font.default_source_id().unwrap();
    let new_glyph = GlyphId::new();
    report(
        "glyph creation + layer",
        &apply(&mut font, vec![
            FontIntent::CreateGlyph { glyph_id: Some(new_glyph.clone()), name: "spike.new".into(), unicodes: vec![0xE000] },
            FontIntent::CreateGlyphLayer { layer_id: LayerId::new(), glyph_id: new_glyph, source_id: source_id.clone() },
        ]),
    );
    report(
        "glyph rename (loaded, ~60 pts)",
        &apply(&mut font, vec![FontIntent::UpdateGlyph { glyph_id: glyph.id(), new_name: shift_font::GlyphName::new("O.renamed").unwrap(), new_unicodes: vec![0x4F] }]),
    );

    // Font-level edits on the kitchen-sink corpus.
    let mut sample = sample_font();
    let added = SourceId::new();
    let mut location = DesignLocation::new();
    let first_axis = sample.axes()[0].clone();
    location.set(first_axis.id(), (first_axis.minimum() + first_axis.default()) / 2.0 + 1.0);
    report("source add", &apply(&mut sample, vec![FontIntent::CreateSource { source_id: added.clone(), name: "Added".into(), location }]));
    let existing = sample.sources()[0].clone();
    report(
        "source rename",
        &apply(&mut sample, vec![FontIntent::UpdateSource {
            source_id: existing.id(),
            name: "Renamed".into(),
            location: existing.location().clone(),
            metric_values: existing.metric_values().clone(),
            italic_angle: existing.italic_angle(),
            line_gap: existing.line_gap(),
            underline_position: existing.underline_position(),
            underline_thickness: existing.underline_thickness(),
        }]),
    );
    let mut axis: Axis = sample.axes()[0].clone();
    axis.set_name("Renamed axis".into());
    report("axis edit", &apply(&mut sample, vec![FontIntent::UpdateAxis { axis }]));

    let glyph_ids: Vec<GlyphId> = font.glyphs().map(|g| g.id()).collect();
    let edits: Vec<KerningValueEdit> = (0..2_000)
        .map(|i| KerningValueEdit {
            source_id: source_id.clone(),
            pair: KerningPair::glyphs(glyph_ids[i % glyph_ids.len()].clone(), glyph_ids[(i * 7 + 3) % glyph_ids.len()].clone()),
            value: Some(-((i % 90) as f64)),
        })
        .collect();
    report("kerning: 2,000 pair values", &apply(&mut font, vec![FontIntent::SetKerningValues { edits }]));

    let fea: String = (0..2_500).map(|i| format!("  sub a{i} by b{i};\n")).collect();
    let fea = format!("feature liga {{\n{fea}}} liga;\n");
    assert!(fea.len() > 50_000);
    // A heavy glyph: one 20,000-point contour; moving one point still ships the layer twice.
    let mut heavy = shift_font::Contour::new();
    for i in 0..20_000 {
        heavy.add_point(i as f64, (i % 97) as f64, shift_font::PointType::OnCurve, false);
    }
    heavy.close();
    let heavy_point = heavy.points()[0].id();
    let heavy_layer = font.glyph_by_name("O.renamed").unwrap().layers().values().next().unwrap().id();
    apply(&mut font, vec![FontIntent::ReplaceGlyphLayerContent { layer_id: heavy_layer.clone(), width: 600.0, contours: vec![heavy], anchors: vec![], components: vec![] }]);
    report("point move, 20k-point layer", &apply(&mut font, vec![FontIntent::MovePoints { layer_id: heavy_layer, point_ids: vec![heavy_point], coords: vec![1.0, 2.0] }]));
    report(&format!("feature source ({} KB)", fea.len() / 1024), &apply(&mut font, vec![FontIntent::SetFeatureSource { source: Some(fea) }]));
}

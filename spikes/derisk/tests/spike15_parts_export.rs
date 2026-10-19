//! Spike 15: decomposed export of parts, compiled by fontc and checked with
//! skrifa against the editor's preview.
//!
//! `Font::decompose_parts` flattens every glyph that uses parts at each master
//! and adds glyph-specific intermediate masters where a linear font would drift
//! from the preview by more than 1 unit. The compiled TTF is drawn with skrifa
//! at 41 weights and compared with `resolve_glyph`.
//!
//! `cargo test --release --test spike15_parts_export -- --nocapture --test-threads=1`

use std::collections::BTreeMap;

use shift_backends::FontExporter;
use shift_font::{
    AxisId, Component, ComponentLocation, Contour, DecomposedTransform, DesignLocation, Font, FontChange, FontChangeSet, Glyph, GlyphAxis, GlyphId, GlyphLayer, LayerId, LayerLocation, PointType,
    Replacement,
};
use shift_workspace::FontWorkspace;
use skrifa::instance::{Location, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::types::F2Dot14;
use skrifa::{FontRef, MetadataProvider};

const MUTATOR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");

fn stroke() -> AxisId {
    AxisId::from_raw("stroke")
}

fn rect(x0: f64, x1: f64, height: f64) -> Contour {
    let mut contour = Contour::new();
    for (x, y) in [(x0, 0.0), (x1, 0.0), (x1, height), (x0, height)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    contour
}

fn weight(font: &Font) -> (AxisId, f64, f64) {
    let axis = font.axes().iter().find(|a| a.tag() == "wght").unwrap();
    (axis.id(), axis.minimum(), axis.maximum())
}

/// A stem part with its own stroke axis: 40 units wide at 0, 120 at 100.
fn stem_part(font: &Font) -> Glyph {
    let default = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_id(GlyphId::from_raw("part_stem"), "part.stem");
    glyph.set_axes(vec![GlyphAxis { id: stroke(), tag: "STRK".into(), name: "Stroke".into(), minimum: 0.0, default: 0.0, maximum: 100.0 }]);
    let mut thin = GlyphLayer::with_width(LayerId::from_raw("stem_thin"), default.clone(), 200.0);
    thin.add_contour(rect(0.0, 40.0, 700.0));
    let mut thick = GlyphLayer::with_width(LayerId::from_raw("stem_thick"), default, 200.0);
    thick.add_contour(rect(0.0, 120.0, 700.0));
    thick.set_location(LayerLocation(BTreeMap::from([(stroke(), 100.0)])));
    glyph.set_layer(thin);
    glyph.set_layer(thick);
    glyph
}

/// A composite whose stem's stroke follows the font's weight and whose scale
/// goes from 1.0 at the lightest master to `bold_scale` at the boldest.
fn composite(font: &Font, id: &str, unicode: u32, bold_scale: f64) -> Glyph {
    let (wght, min, max) = weight(font);
    let mut glyph = Glyph::with_id(GlyphId::from_raw(id), id);
    glyph.set_unicodes(vec![unicode]);
    for source in font.masters() {
        let t = (source.location().get(&wght).unwrap_or(min) - min) / (max - min);
        let scale = 1.0 + (bold_scale - 1.0) * t;
        let mut layer = GlyphLayer::with_width(LayerId::from_raw(format!("{id}_{}", source.id())), source.id(), 600.0);
        let mut component = Component::with_id(
            shift_font::ComponentId::from_raw(format!("{id}_stem_{}", source.id())),
            GlyphId::from_raw("part_stem"),
            "part.stem",
            DecomposedTransform::from_values([100.0, 0.0, 0.0, scale, scale, 0.0, 0.0, 0.0, 0.0]),
        );
        component.set_location(ComponentLocation(BTreeMap::from([(stroke(), 100.0 * t)])));
        layer.add_component(component);
        glyph.set_layer(layer);
    }
    glyph
}

#[derive(Default)]
struct Points(Vec<(f64, f64)>);

impl OutlinePen for Points {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push((x as f64, y as f64));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push((x as f64, y as f64));
    }
    fn quad_to(&mut self, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x as f64, y as f64));
    }
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x as f64, y as f64));
    }
    fn close(&mut self) {}
}

/// The larger of the two one-sided distances between point sets, so contour
/// direction and start point don't matter.
fn set_distance(a: &[(f64, f64)], b: &[(f64, f64)]) -> f64 {
    let one_way = |from: &[(f64, f64)], to: &[(f64, f64)]| {
        from.iter().map(|p| to.iter().map(|q| ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt()).fold(f64::MAX, f64::min)).fold(0.0, f64::max)
    };
    one_way(a, b).max(one_way(b, a))
}

/// Draws `unicode` from the compiled font at each weight and returns the worst
/// distance from the preview.
fn worst_compiled_gap(font: &Font, bytes: &[u8], glyph: &str, unicode: u32) -> (f64, f64) {
    let compiled = FontRef::new(bytes).unwrap();
    let gid = compiled.charmap().map(unicode).unwrap();
    let outline = compiled.outline_glyphs().get(gid).unwrap();
    let normalization = font.design_normalization().unwrap();
    let (wght, min, max) = weight(font);
    let mut worst = (0.0, 0.0);
    for step in 0..=40 {
        let value = min + (max - min) * step as f64 / 40.0;
        let mut design = DesignLocation::new();
        design.set(wght.clone(), value);
        let mut location = Location::new(compiled.axes().len());
        for (i, axis) in compiled.axes().iter().enumerate() {
            let shift_axis = font.axes().iter().position(|a| a.tag() == axis.tag().to_string()).unwrap();
            let design_value = design.get(&font.axes()[shift_axis].id()).unwrap_or(font.axes()[shift_axis].default());
            let normalized = normalization[shift_axis].normalize(design_value);
            location.coords_mut()[i] = F2Dot14::from_f32(normalized as f32).into();
        }
        let mut pen = Points::default();
        outline.draw(DrawSettings::unhinted(Size::unscaled(), &location), &mut pen).unwrap();
        let preview = font.resolve_glyph(&GlyphId::from_raw(glyph), &design).unwrap().points();
        let gap = set_distance(&pen.0, &preview);
        if gap > worst.0 {
            worst = (gap, value);
        }
    }
    worst
}

#[test]
fn compiled_parts_match_the_preview() {
    let store = tempfile::tempdir().unwrap();
    let mut workspace = FontWorkspace::open(MUTATOR, store.path().join("store.sqlite")).unwrap();
    workspace.acquire_all_layers().unwrap();
    let font = workspace.font().clone();
    let changes = vec![
        FontChange::Glyph(Box::new(Replacement { before: None, after: Some(stem_part(&font)) })),
        FontChange::Glyph(Box::new(Replacement { before: None, after: Some(composite(&font, "H_part", 0xE000, 1.0)) })),
        FontChange::Glyph(Box::new(Replacement { before: None, after: Some(composite(&font, "S_part", 0xE001, 0.6)) })),
    ];
    workspace.persist_change_set(FontChangeSet::new(changes), true).unwrap();
    let font = workspace.font().clone();

    let (naive, _) = font.decompose_parts(f64::INFINITY).unwrap();
    // Half a unit for the model leaves room for glyf's integer rounding.
    let (refined, reports) = font.decompose_parts(0.5).unwrap();
    for report in &reports {
        eprintln!(
            "{}: {} masters, gap {:.2} units before, {} intermediates, {:.2} after",
            report.glyph_name, report.masters, report.worst_gap_before, report.intermediates, report.worst_gap_after
        );
    }

    let exporter = FontExporter::new();
    let naive_bytes = exporter.compile_ttf(&naive).map_err(|e| format!("{e}")).unwrap();
    let refined_bytes = exporter.compile_ttf(&refined).map_err(|e| format!("{e}")).unwrap();
    eprintln!("compiled: {} bytes without intermediates, {} with", naive_bytes.len(), refined_bytes.len());

    for (glyph, unicode) in [("H_part", 0xE000), ("S_part", 0xE001)] {
        let (naive_gap, naive_at) = worst_compiled_gap(&font, &naive_bytes, glyph, unicode);
        let (refined_gap, refined_at) = worst_compiled_gap(&font, &refined_bytes, glyph, unicode);
        eprintln!("{glyph}: compiled vs preview, worst over 41 weights: {naive_gap:.2} units without intermediates (at wght {naive_at:.0}), {refined_gap:.2} with (at wght {refined_at:.0})");
        assert!(refined_gap <= 1.0, "{glyph}: {refined_gap}");
    }
}

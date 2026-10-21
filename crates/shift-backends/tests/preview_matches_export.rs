//! What Shift draws while editing must match what it compiles.
//!
//! For each fixture source, every encoded glyph is resolved through Shift's
//! own interpolation and read back from the font Shift compiles, at every
//! named instance, the default, and each axis end. Advances must agree within a unit and outline bounds
//! within two units; compiling converts curves to quadratics and rounds
//! coordinates, so points are not compared one by one.

use shift_font::test_support::fixtures;

use kurbo::{BezPath, Shape};
use shift_backends::FontExporter;
use shift_backends::font_loader::FontLoader;
use shift_font::{Contour, ExternalLocation, Font};
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::{FontRef, MetadataProvider};

#[derive(Default)]
struct PathPen(BezPath);

impl OutlinePen for PathPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to((x as f64, y as f64));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to((x as f64, y as f64));
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.0.quad_to((cx as f64, cy as f64), (x as f64, y as f64));
    }
    fn curve_to(&mut self, ax: f32, ay: f32, bx: f32, by: f32, x: f32, y: f32) {
        self.0.curve_to(
            (ax as f64, ay as f64),
            (bx as f64, by as f64),
            (x as f64, y as f64),
        );
    }
    fn close(&mut self) {
        self.0.close_path();
    }
}

/// Bounds of an outline, or `None` for a glyph without ink.
fn bounds(path: &BezPath) -> Option<[f64; 4]> {
    (!path.elements().is_empty()).then(|| {
        let b = path.bounding_box();
        [b.x0, b.y0, b.x1, b.y1]
    })
}

/// Returns every disagreement between Shift's preview and its export.
///
/// # Panics
///
/// Panics when nothing was compared, so a fixture can't pass vacuously.
fn disagreements(source: &str) -> Vec<String> {
    let font: Font = FontLoader::new().read_font(source).unwrap();
    let bytes = FontExporter::new().compile_ttf(&font).unwrap();
    let compiled = FontRef::new(&bytes).unwrap();
    let tags = compiled
        .axes()
        .iter()
        .map(|axis| axis.tag().to_string())
        .collect::<Vec<_>>();
    let mut found = Vec::new();
    let mut compared = 0;

    // Every named instance, the default, and each axis end with the other
    // axes at their defaults.
    let defaults = compiled
        .axes()
        .iter()
        .map(|axis| axis.default_value())
        .collect::<Vec<_>>();
    let mut locations = compiled
        .named_instances()
        .iter()
        .map(|instance| instance.user_coords().collect::<Vec<_>>())
        .collect::<Vec<_>>();
    locations.push(defaults.clone());
    for (index, axis) in compiled.axes().iter().enumerate() {
        for end in [axis.min_value(), axis.max_value()] {
            let mut location = defaults.clone();
            location[index] = end;
            locations.push(location);
        }
    }

    for coords in locations {
        let user = tags.iter().cloned().zip(coords).collect::<Vec<_>>();
        let location = compiled
            .axes()
            .location(user.iter().map(|(t, v)| (t.as_str(), *v)));
        let external: ExternalLocation = user
            .iter()
            .map(|(tag, value)| (font.axis_id_by_tag(tag).unwrap(), *value as f64))
            .collect();
        let design = font.mapped_location(&external).unwrap();
        let mut projection = font.projection(&design);
        let metrics = compiled.glyph_metrics(Size::unscaled(), &location);
        let outlines = compiled.outline_glyphs();

        for glyph in font.glyphs() {
            let Some(&unicode) = glyph.unicodes().first() else {
                continue;
            };
            let Some(gid) = char::from_u32(unicode).and_then(|c| compiled.charmap().map(c)) else {
                continue;
            };
            let Some(preview) = projection.glyph(&glyph.id()).unwrap() else {
                continue;
            };
            let mut drawn = BezPath::new();
            for contour in preview.contours() {
                let contour = Contour::from_points(contour.points.clone(), contour.closed);
                drawn.extend(BezPath::from(&contour).elements().iter().copied());
            }
            let mut pen = PathPen::default();
            outlines
                .get(gid)
                .unwrap()
                .draw(
                    DrawSettings::unhinted(Size::unscaled(), LocationRef::from(&location)),
                    &mut pen,
                )
                .unwrap();

            compared += 1;
            let at = format!("'{}' at {user:?}", glyph.name());
            let exported_advance = metrics.advance_width(gid).unwrap_or_default() as f64;
            if (preview.x_advance() - exported_advance).abs() > 1.0 {
                found.push(format!(
                    "{at}: advance {} vs {exported_advance}",
                    preview.x_advance()
                ));
            }
            match (bounds(&drawn), bounds(&pen.0)) {
                (Some(a), Some(b)) if a.iter().zip(&b).any(|(x, y)| (x - y).abs() > 2.0) => {
                    found.push(format!("{at}: bounds {a:?} vs {b:?}"));
                }
                (Some(_), None) | (None, Some(_)) => found.push(format!("{at}: ink in one only")),
                _ => {}
            }
        }
    }
    assert!(compared > 0, "{source}: no glyphs compared");
    found
}

#[test]
fn designspace_preview_matches_export() {
    let path = fixtures::font("mutatorsans-variable/MutatorSans.designspace");
    assert_eq!(disagreements(path.to_str().unwrap()), Vec::<String>::new());
}

#[test]
fn glyphs_preview_matches_export() {
    for name in [
        "MutatorSansVariable.glyphs",
        "MappedWeight.glyphs",
        "MultiFamily.glyphs",
        "LightDefault.glyphs",
        "ScaledComponent.glyphs",
    ] {
        let path = fixtures::font(name);
        assert_eq!(
            disagreements(path.to_str().unwrap()),
            Vec::<String>::new(),
            "{name}"
        );
    }
}

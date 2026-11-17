//! A component that sets its own location compiles drawing its base glyph
//! there, as the editor draws it.

use shift_backends::FontExporter;
use shift_font::test_support::sample_variable_font;
use shift_font::{Component, DesignLocation, Font, Glyph, GlyphLayer, LayerId};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::{FontRef, MetadataProvider};

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// The codepoint of the composite the fixture adds.
const COMPOSITE: char = '\u{E000}';

/// The sample font, whose `A` apex moves from x 300 at Weight 400 to 380 at
/// Weight 800, plus a composite of `A` on every master; on the default
/// master its component sets Weight 800, and on the Bold master it sets
/// nothing.
fn font_with_located_component() -> Fixture<Font> {
    let mut font = sample_variable_font();
    let weight = font.axes().first().ok_or("no axis")?.id();
    let default_source = font.default_source_id().ok_or("no default source")?;
    let base = font.glyph_by_name("A").ok_or("no A")?;
    let (base_id, base_name) = (base.id(), base.name().to_owned());
    let master_ids: Vec<_> = base
        .layers()
        .values()
        .map(|layer| layer.source_id())
        .collect();

    let mut composite = Glyph::with_unicode("Aalt", u32::from(COMPOSITE));
    for source_id in master_ids {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 600.0);
        let mut component = Component::new(base_id, base_name.as_str());
        if source_id == default_source {
            component.set_location(DesignLocation::from([(weight, 800.0)]));
        }
        layer.add_component(component);
        composite.set_layer(layer);
    }
    font.insert_glyph(composite)?;
    Ok(font)
}

/// Collects the on-curve points an outline draws.
#[derive(Default)]
struct Points(Vec<(f32, f32)>);

impl OutlinePen for Points {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn quad_to(&mut self, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, x: f32, y: f32) {
        self.0.push((x, y));
    }
    fn close(&mut self) {}
}

/// The points the composite draws at the font's default location.
fn composite_points_at_default(binary: &[u8]) -> Fixture<Vec<(f32, f32)>> {
    let compiled = FontRef::new(binary)?;
    let glyph_id = compiled
        .charmap()
        .map(COMPOSITE)
        .ok_or("the composite is not mapped")?;
    let outline = compiled
        .outline_glyphs()
        .get(glyph_id)
        .ok_or("the composite has no outline")?;
    let mut pen = Points::default();
    outline.draw(
        DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
        &mut pen,
    )?;
    Ok(pen.0)
}

fn compiled_apex() -> Result<Vec<(f32, f32)>, String> {
    let points = font_with_located_component()
        .and_then(|font| Ok(FontExporter::new().compile_ttf(&font)?))
        .and_then(|binary| composite_points_at_default(&binary))
        .map_err(|error| error.to_string())?;
    Ok(points.into_iter().filter(|(_, y)| *y > 600.0).collect())
}

#[test]
fn a_component_set_to_another_weight_compiles_its_base_drawn_there() {
    // At the default location the glyph is at Weight 400, where A's apex is at x 300; the
    // component sets Weight 800, where it is at x 380.
    assert_eq!(compiled_apex(), Ok(vec![(380.0, 700.0)]));
}

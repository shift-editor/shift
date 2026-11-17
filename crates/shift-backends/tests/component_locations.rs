//! A component that sets its own location compiles drawing its base glyph
//! there, as the editor draws it.

mod compiled;

use compiled::Fixture;
use shift_backends::{FontExporter, VariableComponents};
use shift_font::test_support::sample_variable_font;
use shift_font::{
    Anchor, Component, ComponentAlignment, ComponentInheritance, Contour, DesignLocation, Font,
    Glyph, GlyphLayer, LayerId, PointType,
};
use skrifa::FontRef;
use skrifa::raw::TableProvider;

/// The codepoint of the composite the fixture adds.
const COMPOSITE: char = '\u{E000}';

/// How the fixture's composite places `A` on its default master; on the
/// Bold master its component sets nothing and follows the glyph.
#[derive(Clone, Copy)]
enum DefaultMaster {
    /// Sets Weight 800.
    SetsBold,
    /// Sets nothing and takes the font's default location.
    FollowsFont,
}

/// The sample font, whose `A` apex moves from x 300 at Weight 400 to 380 at
/// Weight 800, plus a composite of `A` on every master.
fn font_with_located_component(default_master: DefaultMaster) -> Fixture<Font> {
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
            match default_master {
                DefaultMaster::SetsBold => {
                    component.set_location(DesignLocation::from([(weight, 800.0)]));
                }
                DefaultMaster::FollowsFont => component.set_inheritance(ComponentInheritance::Font),
            }
        }
        layer.add_component(component);
        composite.set_layer(layer);
    }
    font.insert_glyph(composite)?;
    Ok(font)
}

fn compile_composite(
    default_master: DefaultMaster,
    variable_components: VariableComponents,
) -> Fixture<Vec<u8>> {
    let font = font_with_located_component(default_master)?;
    let exporter = FontExporter::new().with_variable_components(variable_components);
    Ok(exporter.compile_ttf(&font)?)
}

/// The composite's apex at the default location, and whether the binary has
/// a `VARC` table.
fn compiled_apex(
    default_master: DefaultMaster,
    variable_components: VariableComponents,
) -> Result<(Vec<(f32, f32)>, bool), String> {
    let compiled = || -> Fixture<_> {
        let binary = compile_composite(default_master, variable_components)?;
        let has_varc = FontRef::new(&binary)?.varc().is_ok();
        let points = compiled::on_curve_points(&binary, COMPOSITE)?;
        Ok((
            points.into_iter().filter(|(_, y)| *y > 600.0).collect(),
            has_varc,
        ))
    };
    compiled().map_err(|error| error.to_string())
}

#[test]
fn a_component_that_sets_its_location_compiles_drawing_its_base_there() {
    // At the default location the glyph is at Weight 400, where A's apex is at x 300.
    let cases = [
        // The component sets Weight 800, where A's apex is at x 380.
        (
            DefaultMaster::SetsBold,
            VariableComponents::Decompose,
            380.0,
            false,
        ),
        // With VARC it stays a variable component, which skrifa draws there.
        (
            DefaultMaster::SetsBold,
            VariableComponents::Varc,
            380.0,
            true,
        ),
        // fontc needs every master of a variable composite to agree on the reset flag. The
        // default master's component takes the font's location and the Bold master's
        // follows the glyph, so export fills both on every axis.
        (
            DefaultMaster::FollowsFont,
            VariableComponents::Varc,
            300.0,
            true,
        ),
    ];
    for (default_master, variable_components, apex_x, has_varc) in cases {
        assert_eq!(
            compiled_apex(default_master, variable_components),
            Ok((vec![(apex_x, 700.0)], has_varc)),
        );
    }
}

/// The sample font with a `top` anchor on `A`'s apex (x 300 at Weight 400,
/// 380 at Weight 800), a `dotmark` whose `_top` sits at x 0 at Weight 400
/// and 60 at Weight 800 under a line starting at x 0 and 50, and a composite
/// `A` + `dotmark`, the mark anchored, set to Weight 800, and stored where
/// each master's own anchors put it.
fn font_with_located_mark() -> Fixture<Font> {
    let mut font = sample_variable_font();
    let weight = font.axes().first().ok_or("no axis")?.id();
    let default_source = font.default_source_id().ok_or("no default source")?;
    let base = font.glyph_by_name("A").ok_or("no A")?;
    let (base_id, base_name) = (base.id(), base.name().to_owned());
    let masters: Vec<_> = base
        .layers()
        .values()
        .map(|layer| (layer.id(), layer.source_id()))
        .collect();

    let mut mark = Glyph::new("dotmark");
    let mut composite = Glyph::with_unicode("Adot", u32::from(COMPOSITE));
    for (base_layer, source_id) in masters {
        let bold = source_id != default_source;
        let (apex, mark_x, mark_anchor) = if bold {
            (380.0, 50.0, 60.0)
        } else {
            (300.0, 0.0, 0.0)
        };
        font.layer_mut(base_layer)
            .ok_or("no A layer")?
            .add_anchor(Anchor::new("top".to_owned(), apex, 700.0));

        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 0.0);
        let mut contour = Contour::new();
        contour.add_point(mark_x, 100.0, PointType::OnCurve, false);
        contour.add_point(mark_x + 20.0, 100.0, PointType::OnCurve, false);
        layer.add_contour(contour);
        layer.add_anchor(Anchor::new("_top".to_owned(), mark_anchor, 0.0));
        mark.set_layer(layer);

        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 600.0);
        layer.add_component(Component::new(base_id, base_name.as_str()));
        let mut dot = Component::new(mark.id(), "dotmark");
        dot.set_alignment(ComponentAlignment::Anchored);
        dot.translate(apex - mark_anchor, 700.0);
        dot.set_location(DesignLocation::from([(weight, 800.0)]));
        layer.add_component(dot);
        composite.set_layer(layer);
    }
    font.insert_glyph(mark)?;
    font.insert_glyph(composite)?;
    Ok(font)
}

#[test]
fn an_anchored_mark_drawn_elsewhere_compiles_on_its_anchor_there() {
    // At Weight 400 the apex is at x 300. The mark is drawn at Weight 800,
    // where its `_top` is at x 60 and its line starts at 50, so it starts at
    // 300 - 60 + 50 = 290; the stored offset alone would put it at 350.
    for variable_components in [VariableComponents::Decompose, VariableComponents::Varc] {
        let mark = || -> Fixture<_> {
            let exporter = FontExporter::new().with_variable_components(variable_components);
            let binary = exporter.compile_ttf(&font_with_located_mark()?)?;
            let points = compiled::on_curve_points(&binary, COMPOSITE)?;
            let mut points: Vec<_> = points.into_iter().filter(|(_, y)| *y > 750.0).collect();
            points.sort_by(|a, b| a.0.total_cmp(&b.0));
            Ok(points)
        };
        assert_eq!(
            mark().map_err(|error| error.to_string()),
            Ok(vec![(290.0, 800.0), (310.0, 800.0)]),
        );
    }
}

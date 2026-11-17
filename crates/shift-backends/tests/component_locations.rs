//! A component that sets its own location compiles drawing its base glyph
//! there, as the editor draws it.

mod compiled;

use compiled::Fixture;
use shift_backends::{FontExporter, VariableComponents};
use shift_font::test_support::sample_variable_font;
use shift_font::{
    Component, ComponentInheritance, DesignLocation, Font, Glyph, GlyphLayer, LayerId,
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

//! A glyph's swaps compile to `rvrn` feature variations: shaping the
//! compiled font draws the first swap that holds, as the editor does.

use std::str::FromStr;

use harfrust::{ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer, Variation};
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingPoint, Condition, ConditionRange, Contour,
    DesignLocation, Font, Glyph, GlyphId, GlyphLayer, GlyphSwap, LayerId, Location, PointType,
    Source, SourceId, SwapId,
};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId as CompiledGlyphId, MetadataProvider};

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// Bleed (0–100, default 0) and Width (50–100, default 100), with masters
/// at the default and at full Bleed, and `dollar` and `cent` mapped.
struct Axes {
    font: Font,
    bleed: AxisId,
    width: AxisId,
    masters: [SourceId; 2],
}

impl Axes {
    fn new() -> Fixture<Self> {
        let mut font = Font::new();
        let bleed = Axis::new("BLED".into(), "Bleed".into(), 0.0, 0.0, 100.0);
        let width = Axis::new("wdth".into(), "Width".into(), 50.0, 100.0, 100.0);
        let (bleed_id, width_id) = (bleed.id(), width.id());
        font.add_axis(bleed)?;
        font.add_axis(width)?;
        let regular = font.default_source_id().ok_or("no default source")?;
        font.source_mut(regular)
            .ok_or("no default source")?
            .set_location(DesignLocation::from([(bleed_id, 0.0), (width_id, 100.0)]));
        let bled = font.add_source(Source::new(
            "Bled".into(),
            DesignLocation::from([(bleed_id, 100.0), (width_id, 100.0)]),
        ));
        let mut fixture = Self {
            font,
            bleed: bleed_id,
            width: width_id,
            masters: [regular, bled],
        };
        for name in ["dollar.bled", "dollar.heavy", "dollar.narrow", "cent.bled"] {
            fixture.glyph(name, None)?;
        }
        fixture.glyph("dollar", Some('$'))?;
        fixture.glyph("cent", Some('¢'))?;
        Ok(fixture)
    }

    /// A glyph drawing a bar, on both masters.
    fn glyph(&mut self, name: &str, character: Option<char>) -> Fixture<GlyphId> {
        let mut glyph = Glyph::with_id(GlyphId::from_raw(name), name);
        if let Some(character) = character {
            glyph.set_unicodes(vec![u32::from(character)]);
        }
        for source in self.masters {
            let mut layer = GlyphLayer::with_width(LayerId::new(), source, 500.0);
            let mut contour = Contour::new();
            for (x, y) in [(0.0, 0.0), (100.0, 0.0), (100.0, 700.0), (0.0, 700.0)] {
                contour.add_point(x, y, PointType::OnCurve, false);
            }
            contour.close();
            layer.add_contour(contour);
            glyph.set_layer(layer);
        }
        Ok(self.font.insert_glyph(glyph)?)
    }

    /// Sets `glyph`'s swaps, each a glyph and the Bleed it starts at,
    /// with an optional Width it ends at.
    fn swaps(&mut self, glyph: &str, swaps: &[(&str, f64, Option<f64>)]) -> Fixture<()> {
        let swaps = swaps
            .iter()
            .map(|(name, bleed, width)| {
                let mut ranges = vec![ConditionRange::new(self.bleed, Some(*bleed), None)];
                if let Some(width) = width {
                    ranges.push(ConditionRange::new(self.width, None, Some(*width)));
                }
                GlyphSwap::new(
                    SwapId::new(),
                    Condition::all(ranges),
                    GlyphId::from_raw(name),
                )
            })
            .collect();
        self.font.set_glyph_swaps(GlyphId::from_raw(glyph), swaps)?;
        Ok(())
    }

    fn compile(&self) -> Fixture<Vec<u8>> {
        Ok(FontExporter::new().compile_ttf(&self.font)?)
    }
}

/// The names of the glyphs HarfBuzz's shaping (through HarfRust) draws for
/// `text` at user `bleed` and `width`.
fn shape_at(binary: &[u8], text: &str, bleed: f32, width: f32) -> Fixture<Vec<String>> {
    let font = harfrust::FontRef::new(binary)?;
    let data = ShaperData::new(&font);
    let variations = [
        Variation {
            tag: Tag::from_str("BLED")?,
            value: bleed,
        },
        Variation {
            tag: Tag::from_str("wdth")?,
            value: width,
        },
    ];
    let instance = ShaperInstance::from_variations(&font, variations);
    let shaper = data.shaper(&font).instance(Some(&instance)).build();
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let shaped = shaper.shape(buffer, ShapeOptions::new());
    let names = FontRef::new(binary)?.glyph_names();
    shaped
        .glyph_infos()
        .iter()
        .map(|info| {
            names
                .get(CompiledGlyphId::new(info.glyph_id))
                .map(|name| name.to_string())
                .ok_or_else(|| "a shaped glyph has no name".into())
        })
        .collect()
}

/// A glyph's swaps: each a glyph, the Bleed it starts at, and an
/// optional Width it ends at.
type SwapList<'a> = &'a [(&'a str, f64, Option<f64>)];

/// The fixture with `swaps` set, glyph by glyph, compiled.
fn compile_with_swaps(swaps: &[(&str, SwapList)]) -> Fixture<Vec<u8>> {
    let mut axes = Axes::new()?;
    for (glyph, list) in swaps {
        axes.swaps(glyph, list)?;
    }
    axes.compile()
}

/// What `text` shapes to in the fixture with `swaps`, at each user
/// (Bleed, Width), as space-separated glyph names.
fn drawn_glyphs(
    swaps: &[(&str, SwapList)],
    text: &str,
    locations: &[(f32, f32)],
) -> Result<Vec<String>, String> {
    let read = || -> Fixture<Vec<String>> {
        let binary = compile_with_swaps(swaps)?;
        locations
            .iter()
            .map(|(bleed, width)| Ok(shape_at(&binary, text, *bleed, *width)?.join(" ")))
            .collect()
    };
    read().map_err(|error| error.to_string())
}

/// What `$` shapes to at each Bleed, at full Width.
fn dollar_at(swaps: SwapList, bleeds: &[f32]) -> Result<Vec<String>, String> {
    let locations: Vec<_> = bleeds.iter().map(|bleed| (*bleed, 100.0)).collect();
    drawn_glyphs(&[("dollar", swaps)], "$", &locations)
}

fn expected_glyphs(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn a_swap_is_drawn_from_its_condition_on() {
    assert_eq!(
        dollar_at(&[("dollar.bled", 70.0, None)], &[0.0, 69.0, 70.0, 100.0]),
        Ok(expected_glyphs(&[
            "dollar",
            "dollar",
            "dollar.bled",
            "dollar.bled"
        ])),
    );
}

#[test]
fn the_first_swap_that_holds_wins_where_two_overlap() {
    // dollar.heavy from Bleed 80 overlaps dollar.bled from 70, and comes first.
    assert_eq!(
        dollar_at(
            &[("dollar.heavy", 80.0, None), ("dollar.bled", 70.0, None)],
            &[69.0, 75.0, 79.0, 80.0, 100.0]
        ),
        Ok(expected_glyphs(&[
            "dollar",
            "dollar.bled",
            "dollar.bled",
            "dollar.heavy",
            "dollar.heavy"
        ])),
    );
    // In the other order, dollar.bled covers dollar.heavy's whole region.
    assert_eq!(
        dollar_at(
            &[("dollar.bled", 70.0, None), ("dollar.heavy", 80.0, None)],
            &[69.0, 75.0, 100.0]
        ),
        Ok(expected_glyphs(&["dollar", "dollar.bled", "dollar.bled"])),
    );
}

#[test]
fn a_narrower_swap_first_holds_only_inside_its_box() {
    // dollar.narrow from Bleed 70 up to Width 80, then dollar.bled from Bleed 70.
    let swaps: SwapList = &[
        ("dollar.narrow", 70.0, Some(80.0)),
        ("dollar.bled", 70.0, None),
    ];
    assert_eq!(
        drawn_glyphs(
            &[("dollar", swaps)],
            "$",
            &[(90.0, 80.0), (90.0, 81.0), (69.0, 60.0), (70.0, 50.0)]
        ),
        Ok(expected_glyphs(&[
            "dollar.narrow",
            "dollar.bled",
            "dollar",
            "dollar.narrow"
        ])),
    );
}

#[test]
fn a_swap_glyphs_own_swaps_are_not_applied() {
    let swaps: &[(&str, SwapList)] = &[
        ("dollar", &[("dollar.bled", 70.0, None)]),
        ("dollar.bled", &[("dollar.heavy", 50.0, None)]),
    ];
    assert_eq!(
        drawn_glyphs(swaps, "$", &[(60.0, 100.0), (90.0, 100.0)]),
        Ok(expected_glyphs(&["dollar", "dollar.bled"])),
    );
}

/// The number of `FeatureVariationRecord`s in `binary`'s `GSUB`.
fn feature_variation_records(binary: &[u8]) -> Fixture<usize> {
    let gsub = FontRef::new(binary)?.gsub()?;
    Ok(gsub
        .feature_variations()
        .ok_or("GSUB has no feature variations")??
        .feature_variation_records()
        .len())
}

#[test]
fn glyphs_with_the_same_condition_share_feature_variation_records() {
    let swaps: &[(&str, SwapList)] = &[
        (
            "dollar",
            &[("dollar.heavy", 80.0, None), ("dollar.bled", 70.0, None)],
        ),
        ("cent", &[("cent.bled", 70.0, None)]),
    ];
    assert_eq!(
        drawn_glyphs(swaps, "$¢", &[(75.0, 100.0), (90.0, 100.0)]),
        Ok(expected_glyphs(&[
            "dollar.bled cent.bled",
            "dollar.heavy cent.bled"
        ])),
    );
    // Two regions draw swaps, Bleed 70–80 and 80–100: one record each.
    let records = compile_with_swaps(swaps)
        .and_then(|binary| feature_variation_records(&binary))
        .map_err(|error| error.to_string());
    assert_eq!(records, Ok(2));
}

/// The fixture with `swaps` exported as a designspace, then compiled
/// from that designspace by fontc's own designspace reader.
fn compile_through_designspace(axes: &Axes) -> Fixture<Vec<u8>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("Swaps.designspace");
    FontExporter::new().export(
        &axes.font,
        FontExportRequest {
            path: path.clone(),
            format: ExportFormat::Designspace,
        },
    )?;
    let source = fontc::Input::new(&path)?.create_source(&fontc::SourceOptions::default())?;
    Ok(fontc::generate_font(source, fontc::Options::default())?)
}

/// What `$` shapes to at each user Bleed, at full Width, in the fixture
/// with `dollar`'s `swaps` exported as a designspace and compiled
/// from it, and in the fixture compiled directly.
fn dollar_through_designspace(
    axes: &mut Axes,
    swaps: SwapList,
    bleeds: &[f32],
) -> Result<[Vec<String>; 2], String> {
    let mut read = || -> Fixture<[Vec<String>; 2]> {
        axes.swaps("dollar", swaps)?;
        let shape = |binary: &[u8]| -> Fixture<Vec<String>> {
            bleeds
                .iter()
                .map(|bleed| Ok(shape_at(binary, "$", *bleed, 100.0)?.join(" ")))
                .collect()
        };
        Ok([
            shape(&compile_through_designspace(axes)?)?,
            shape(&axes.compile()?)?,
        ])
    };
    read().map_err(|error| error.to_string())
}

#[test]
fn designspace_rules_compile_in_fontc_as_shift_compiles_the_swaps() {
    let cases: [(SwapList, &[f32], &[&str]); 2] = [
        (
            &[("dollar.bled", 70.0, None)],
            &[0.0, 69.0, 70.0, 100.0],
            &["dollar", "dollar", "dollar.bled", "dollar.bled"],
        ),
        // fontc applies overlapping rules in glyph-name order, which would
        // pick dollar.bled over dollar.heavy, so these are written as
        // disjoint regions.
        (
            &[("dollar.heavy", 80.0, None), ("dollar.bled", 70.0, None)],
            &[69.0, 75.0, 85.0, 100.0],
            &["dollar", "dollar.bled", "dollar.heavy", "dollar.heavy"],
        ),
    ];
    for (swaps, bleeds, drawn) in cases {
        let drawn = expected_glyphs(drawn);
        assert_eq!(
            Axes::new()
                .map_err(|error| error.to_string())
                .and_then(|mut axes| dollar_through_designspace(&mut axes, swaps, bleeds)),
            Ok([drawn.clone(), drawn]),
            "{swaps:?}"
        );
    }
}

#[test]
fn designspace_rule_conditions_are_design_values_through_the_axis_mapping() {
    // User Bleed 50 is design 80, so dollar.bled from design 80 draws from user 50.
    let mut axes = mapped_bleed().expect("the fixture builds");

    let drawn = expected_glyphs(&["dollar", "dollar", "dollar.bled", "dollar.bled"]);
    assert_eq!(
        dollar_through_designspace(
            &mut axes,
            &[("dollar.bled", 80.0, None)],
            &[0.0, 49.0, 51.0, 100.0]
        ),
        Ok([drawn.clone(), drawn]),
    );
}

/// The fixture with Bleed mapped from user 0, 50, 100 to design 0, 80, 100.
fn mapped_bleed() -> Fixture<Axes> {
    let mut axes = Axes::new()?;
    let bleed = axes.bleed;
    let point = |user: f64, design: f64| AxisMappingPoint {
        description: None,
        input: Location::from([(bleed, user)]),
        output: Location::from([(bleed, design)]),
    };
    axes.font.set_axis_mappings(vec![AxisMapping::new(
        "Bleed".into(),
        vec![bleed],
        vec![bleed],
        vec![point(0.0, 0.0), point(50.0, 80.0), point(100.0, 100.0)],
    )])?;
    Ok(axes)
}

/// A rule's conditions, as (axis, minimum, maximum), and substitutions.
type ReadRule = (
    Vec<(String, Option<f32>, Option<f32>)>,
    Vec<(String, String)>,
);

/// The fixture with `swaps` exported as a designspace, and the rules
/// that designspace holds, with their processing.
fn exported_rules(
    swaps: &[(&str, SwapList)],
) -> Fixture<(norad::designspace::RuleProcessing, Vec<ReadRule>)> {
    let mut axes = Axes::new()?;
    for (glyph, list) in swaps {
        axes.swaps(glyph, list)?;
    }
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("Swaps.designspace");
    FontExporter::new().export(
        &axes.font,
        FontExportRequest {
            path: path.clone(),
            format: ExportFormat::Designspace,
        },
    )?;
    let rules = norad::designspace::DesignSpaceDocument::load(&path)?.rules;
    let read = rules
        .rules
        .iter()
        .map(|rule| {
            let conditions = rule
                .condition_sets
                .iter()
                .flat_map(|set| &set.conditions)
                .map(|condition| (condition.name.clone(), condition.minimum, condition.maximum))
                .collect();
            let substitutions = rule
                .substitutions
                .iter()
                .map(|sub| (sub.name.to_string(), sub.with.to_string()))
                .collect();
            (conditions, substitutions)
        })
        .collect();
    Ok((rules.processing, read))
}

#[test]
fn designspace_rules_carry_swaps_that_never_overlap_as_authored() {
    let rules = exported_rules(&[
        ("dollar", &[("dollar.narrow", 70.0, Some(80.0))]),
        ("cent", &[("cent.bled", 70.0, None)]),
    ])
    .map_err(|error| error.to_string());

    let named = |name: &str| name.to_string();
    assert_eq!(
        rules,
        Ok((
            norad::designspace::RuleProcessing::First,
            vec![
                (
                    vec![
                        (named("Bleed"), Some(70.0), None),
                        (named("Width"), None, Some(80.0))
                    ],
                    vec![(named("dollar"), named("dollar.narrow"))]
                ),
                (
                    vec![(named("Bleed"), Some(70.0), None)],
                    vec![(named("cent"), named("cent.bled"))]
                ),
            ]
        ))
    );
}

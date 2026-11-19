//! A glyph's alternates compile to `rvrn` feature variations: shaping the
//! compiled font draws the first alternate that holds, as the editor does.

use std::str::FromStr;

use harfrust::{ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer, Variation};
use shift_backends::FontExporter;
use shift_font::{
    AlternateId, Axis, AxisId, Condition, ConditionRange, Contour, DesignLocation, Font, Glyph,
    GlyphAlternate, GlyphId, GlyphLayer, LayerId, PointType, Source, SourceId,
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

    /// Sets `glyph`'s alternates, each a glyph and the Bleed it starts at,
    /// with an optional Width it ends at.
    fn alternates(&mut self, glyph: &str, alternates: &[(&str, f64, Option<f64>)]) -> Fixture<()> {
        let alternates = alternates
            .iter()
            .map(|(name, bleed, width)| {
                let mut ranges = vec![ConditionRange::new(self.bleed, Some(*bleed), None)];
                if let Some(width) = width {
                    ranges.push(ConditionRange::new(self.width, None, Some(*width)));
                }
                GlyphAlternate::new(
                    AlternateId::new(),
                    Condition::all(ranges),
                    GlyphId::from_raw(name),
                )
            })
            .collect();
        self.font
            .set_glyph_alternates(GlyphId::from_raw(glyph), alternates)?;
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

/// A glyph's alternates: each a glyph, the Bleed it starts at, and an
/// optional Width it ends at.
type AlternateList<'a> = &'a [(&'a str, f64, Option<f64>)];

/// The fixture with `alternates` set, glyph by glyph, compiled.
fn compile_with_alternates(alternates: &[(&str, AlternateList)]) -> Fixture<Vec<u8>> {
    let mut axes = Axes::new()?;
    for (glyph, list) in alternates {
        axes.alternates(glyph, list)?;
    }
    axes.compile()
}

/// What `text` shapes to in the fixture with `alternates`, at each user
/// (Bleed, Width), as space-separated glyph names.
fn drawn_glyphs(
    alternates: &[(&str, AlternateList)],
    text: &str,
    locations: &[(f32, f32)],
) -> Result<Vec<String>, String> {
    let read = || -> Fixture<Vec<String>> {
        let binary = compile_with_alternates(alternates)?;
        locations
            .iter()
            .map(|(bleed, width)| Ok(shape_at(&binary, text, *bleed, *width)?.join(" ")))
            .collect()
    };
    read().map_err(|error| error.to_string())
}

/// What `$` shapes to at each Bleed, at full Width.
fn dollar_at(alternates: AlternateList, bleeds: &[f32]) -> Result<Vec<String>, String> {
    let locations: Vec<_> = bleeds.iter().map(|bleed| (*bleed, 100.0)).collect();
    drawn_glyphs(&[("dollar", alternates)], "$", &locations)
}

fn expected_glyphs(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn an_alternate_is_drawn_from_its_condition_on() {
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
fn the_first_alternate_that_holds_wins_where_two_overlap() {
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
fn a_narrower_alternate_first_holds_only_inside_its_box() {
    // dollar.narrow from Bleed 70 up to Width 80, then dollar.bled from Bleed 70.
    let alternates: AlternateList = &[
        ("dollar.narrow", 70.0, Some(80.0)),
        ("dollar.bled", 70.0, None),
    ];
    assert_eq!(
        drawn_glyphs(
            &[("dollar", alternates)],
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
fn an_alternate_glyphs_own_alternates_are_not_applied() {
    let alternates: &[(&str, AlternateList)] = &[
        ("dollar", &[("dollar.bled", 70.0, None)]),
        ("dollar.bled", &[("dollar.heavy", 50.0, None)]),
    ];
    assert_eq!(
        drawn_glyphs(alternates, "$", &[(60.0, 100.0), (90.0, 100.0)]),
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
    let alternates: &[(&str, AlternateList)] = &[
        (
            "dollar",
            &[("dollar.heavy", 80.0, None), ("dollar.bled", 70.0, None)],
        ),
        ("cent", &[("cent.bled", 70.0, None)]),
    ];
    assert_eq!(
        drawn_glyphs(alternates, "$¢", &[(75.0, 100.0), (90.0, 100.0)]),
        Ok(expected_glyphs(&[
            "dollar.bled cent.bled",
            "dollar.heavy cent.bled"
        ])),
    );
    // Two regions draw alternates, Bleed 70–80 and 80–100: one record each.
    let records = compile_with_alternates(alternates)
        .and_then(|binary| feature_variation_records(&binary))
        .map_err(|error| error.to_string());
    assert_eq!(records, Ok(2));
}

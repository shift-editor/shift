//! Static instances compile to what the variable font is at each named
//! instance: the same outlines, advances and kerning, measured in the
//! compiled binaries.

mod outlines;
mod support;

use std::path::Path;
use std::str::FromStr;

use harfrust::{Feature, ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer, Variation};
use kurbo::BezPath;
use outlines::{Outline, outline_distance};
use shift_backends::{BinaryEncodings, ExportError, FontExporter, StaticInstanceFile};
use shift_font::test_support::sample_variable_font;
use shift_font::{Font, NamedInstance};
use skrifa::outline::DrawSettings;
use skrifa::prelude::{LocationRef, Size};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use support::mutatorsans;

/// A fixture step that fails with a reason instead of panicking.
type Fixture<T> = Result<T, Box<dyn std::error::Error>>;

/// Both binaries round coordinates to integers, by different paths.
const TOLERANCE: f32 = 1.0;

/// How far apart two outlines may run. TrueType outlines are quadratic, and
/// fontc converts a variable font's cubic curves for every master together
/// but a static font's for its one master, so the same curve can be split
/// into different quadratic segments; the shapes agree only to within the
/// conversion's accuracy plus rounding.
const OUTLINE_TOLERANCE: f64 = 1.5;

/// The user location the variable binary's `fvar` gives the instance
/// named `name`, as `(tag, value)` pairs.
fn fvar_location(variable: &[u8], name: &str) -> Fixture<Vec<(String, f32)>> {
    let font = FontRef::new(variable)?;
    let tags: Vec<String> = font
        .axes()
        .iter()
        .map(|axis| axis.tag().to_string())
        .collect();
    for instance in font.named_instances().iter() {
        let instance_name = font
            .localized_strings(instance.subfamily_name_id())
            .english_or_first()
            .map(|string| string.to_string());
        if instance_name.as_deref() == Some(name) {
            return Ok(tags.iter().cloned().zip(instance.user_coords()).collect());
        }
    }
    Err(format!("the variable font has no instance named {name:?}").into())
}

/// A glyph's outline points and advance, at `location` in a variable
/// binary or at the default of a static one.
fn outline_and_advance(
    bytes: &[u8],
    location: &[(String, f32)],
    character: char,
) -> Fixture<(BezPath, f32)> {
    let font = FontRef::new(bytes)?;
    let coords = font
        .axes()
        .location(location.iter().map(|(tag, value)| (tag.as_str(), *value)));
    let location_ref = LocationRef::from(&coords);
    let gid: GlyphId = font
        .charmap()
        .map(character)
        .ok_or_else(|| format!("{character:?} is not mapped"))?;
    let mut outline = Outline::default();
    font.outline_glyphs()
        .get(gid)
        .ok_or("mapped glyphs have outlines")?
        .draw(
            DrawSettings::unhinted(Size::unscaled(), location_ref),
            &mut outline,
        )?;
    let advance = font
        .glyph_metrics(Size::unscaled(), location_ref)
        .advance_width(gid)
        .ok_or("mapped glyphs have advances")?;
    Ok((outline.0, advance))
}

/// The kern between the two characters of `text` at `location`: the first
/// glyph's advance with kerning on, less its advance with kerning off.
fn kern(bytes: &[u8], location: &[(String, f32)], text: &str) -> Fixture<i32> {
    let font = harfrust::FontRef::new(bytes)?;
    let data = ShaperData::new(&font);
    let variations: Vec<_> = location
        .iter()
        .map(|(tag, value)| -> Fixture<Variation> {
            Ok(Variation {
                tag: Tag::from_str(tag)?,
                value: *value,
            })
        })
        .collect::<Fixture<_>>()?;
    let instance = ShaperInstance::from_variations(&font, variations);
    let shaper = data.shaper(&font).instance(Some(&instance)).build();
    let first_advance = |features: &[Feature]| {
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = shaper.shape(buffer, ShapeOptions::new().features(features));
        shaped
            .glyph_positions()
            .first()
            .map(|position| position.x_advance)
    };
    let no_kern = [Feature::from_str("-kern")?];
    let kerned = first_advance(&[]).ok_or("shaped text has glyphs")?;
    let unkerned = first_advance(&no_kern).ok_or("shaped text has glyphs")?;
    Ok(kerned - unkerned)
}

/// The characters both binaries map, up to `limit`.
fn mapped_characters(font: &Font, limit: usize) -> Vec<char> {
    font.glyphs()
        .filter_map(|glyph| glyph.unicodes().first().copied())
        .filter_map(char::from_u32)
        .take(limit)
        .collect()
}

/// What a static instance differs in from the variable font at its
/// location, beyond rounding.
fn differences(
    font: &Font,
    variable: &[u8],
    instance: &NamedInstance,
    static_bytes: &[u8],
) -> Fixture<Vec<String>> {
    let location = fvar_location(variable, instance.name())?;
    let characters = mapped_characters(font, 24);
    let mut differences = Vec::new();
    for character in &characters {
        let (variable_outline, variable_advance) =
            outline_and_advance(variable, &location, *character)?;
        let (static_outline, static_advance) = outline_and_advance(static_bytes, &[], *character)?;
        let distance = outline_distance(&variable_outline, &static_outline);
        if distance > OUTLINE_TOLERANCE {
            differences.push(format!(
                "{character:?} outlines differ by up to {distance:.2}"
            ));
        }
        if (variable_advance - static_advance).abs() > TOLERANCE {
            differences.push(format!(
                "{character:?} advance: {variable_advance} vs {static_advance}"
            ));
        }
    }
    for first in &characters {
        for second in &characters {
            let text: String = [*first, *second].iter().collect();
            let variable_kern = kern(variable, &location, &text)?;
            let static_kern = kern(static_bytes, &[], &text)?;
            if (variable_kern - static_kern).abs() > 1 {
                differences.push(format!("{text:?} kern: {variable_kern} vs {static_kern}"));
            }
        }
    }
    Ok(differences)
}

/// Exports every instance of `font` and compares each with the variable
/// font; returns how many instances were compared.
fn compare_every_instance(font: &Font, directory: &Path) -> Fixture<usize> {
    let exporter = FontExporter::new();
    let variable = exporter.compile_ttf(font)?;
    let written =
        exporter.export_static_instances_with(font, directory, &BinaryEncodings::ttf())?;
    let mut failures = Vec::new();
    for (instance, result) in font.named_instances().iter().zip(&written) {
        let static_bytes = std::fs::read(&result.path)?;
        for difference in differences(font, &variable, instance, &static_bytes)? {
            failures.push(format!("{}: {difference}", instance.name()));
        }
    }
    if !failures.is_empty() {
        return Err(failures.join("\n").into());
    }
    Ok(written.len())
}

#[test]
fn every_static_instance_matches_the_variable_font_there() {
    let temp = tempfile::tempdir().unwrap();

    let compared = compare_every_instance(&sample_variable_font(), temp.path()).unwrap();

    assert_eq!(compared, 1);
}

#[test]
fn every_mutatorsans_instance_matches_the_variable_font_there() {
    let font = mutatorsans();
    let temp = tempfile::tempdir().unwrap();

    let compared = compare_every_instance(&font, temp.path()).unwrap();

    assert_eq!(compared, font.named_instances().len());
    assert!(compared > 1);
}

#[test]
fn static_files_are_named_after_their_instances() {
    let font = mutatorsans();

    let files = FontExporter::static_instance_files(&font).unwrap();

    assert_eq!(files.len(), font.named_instances().len());
    let first = files.first().unwrap();
    assert!(first.file_name.ends_with(".ttf"));
    assert!(!first.file_name.contains(' '));
}

#[test]
fn a_font_without_axes_exports_one_static_file() {
    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Lab Mono".to_string());

    let files = FontExporter::static_instance_files(&font).unwrap();

    assert_eq!(
        files,
        [StaticInstanceFile {
            style_name: "Regular".to_string(),
            file_name: "LabMono-Regular.ttf".to_string(),
        }]
    );
}

#[test]
fn a_variable_font_without_instances_has_nothing_to_export() {
    let mut font = sample_variable_font();
    font.set_named_instances(Vec::new()).unwrap();
    let temp = tempfile::tempdir().unwrap();

    let result = FontExporter::new().export_static_instances_with(
        &font,
        temp.path(),
        &BinaryEncodings::ttf(),
    );

    assert!(matches!(result, Err(ExportError::NoNamedInstances)));
}

#[test]
fn an_instance_without_a_postscript_name_drops_what_postscript_names_leave_out() {
    let mut font = sample_variable_font();
    font.metadata_mut().family_name = Some("Solenoid".to_string());
    let location = font.named_instances()[0].location().clone();
    let instance = NamedInstance::new("Coarse Wide (Ünï)/2".to_string(), location, None);
    font.set_named_instances(vec![instance]).unwrap();

    let files = FontExporter::static_instance_files(&font).unwrap();

    assert_eq!(files[0].file_name, "Solenoid-CoarseWiden2.ttf");
}

/// Weight 100–900 with masters at 400 and 900, `dollar` (a 100-wide bar,
/// advance 500) and `dollar.heavy` (a 300-wide bar, advance 650), with
/// `dollar.heavy` drawn for `dollar` from Weight 800, and instances
/// Regular (400) and Black (900).
fn heavy_dollar_font() -> Fixture<Font> {
    use shift_font::{
        AlternateId, Axis, Condition, ConditionRange, Contour, DesignLocation, ExternalLocation,
        Glyph, GlyphAlternate, GlyphLayer, LayerId, PointType, Source,
    };

    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Heavy Dollar".to_string());
    let weight = Axis::new("wght".into(), "Weight".into(), 100.0, 400.0, 900.0);
    let weight_id = weight.id();
    font.add_axis(weight)?;
    let regular = font.default_source_id().ok_or("no default source")?;
    font.source_mut(regular)
        .ok_or("no default source")?
        .set_location(DesignLocation::from([(weight_id, 400.0)]));
    let black = font.add_source(Source::new(
        "Black".into(),
        DesignLocation::from([(weight_id, 900.0)]),
    ));
    let mut bar = |name: &str, unicode: Option<char>, width: f64, advance: f64| -> Fixture<_> {
        let mut glyph = Glyph::new(name);
        if let Some(unicode) = unicode {
            glyph.set_unicodes(vec![u32::from(unicode)]);
        }
        for source in [regular, black] {
            let mut layer = GlyphLayer::with_width(LayerId::new(), source, advance);
            let mut contour = Contour::new();
            for (x, y) in [(0.0, 0.0), (width, 0.0), (width, 700.0), (0.0, 700.0)] {
                contour.add_point(x, y, PointType::OnCurve, false);
            }
            contour.close();
            layer.add_contour(contour);
            glyph.set_layer(layer);
        }
        Ok(font.insert_glyph(glyph)?)
    };
    let heavy = bar("dollar.heavy", None, 300.0, 650.0)?;
    let dollar = bar("dollar", Some('$'), 100.0, 500.0)?;
    font.set_glyph_alternates(
        dollar,
        vec![GlyphAlternate::new(
            AlternateId::new(),
            Condition::all([ConditionRange::new(weight_id, Some(800.0), None)]),
            heavy,
        )],
    )?;
    let instance = |name: &str, value: f64| {
        NamedInstance::new(
            name.to_string(),
            ExternalLocation::from([(weight_id, value)]),
            None,
        )
    };
    font.set_named_instances(vec![instance("Regular", 400.0), instance("Black", 900.0)])?;
    Ok(font)
}

/// The name, ink width and advance of the glyph `character` maps to in a
/// static binary.
fn mapped_glyph(bytes: &[u8], character: char) -> Fixture<(String, f64, f32)> {
    let font = FontRef::new(bytes)?;
    let gid = font
        .charmap()
        .map(character)
        .ok_or_else(|| format!("{character:?} is not mapped"))?;
    let name = font
        .glyph_names()
        .get(gid)
        .ok_or("mapped glyphs have names")?
        .to_string();
    let (outline, advance) = outline_and_advance(bytes, &[], character)?;
    let ink = kurbo::Shape::bounding_box(&outline).width();
    Ok((name, ink, advance))
}

#[test]
fn a_static_instance_draws_the_alternate_that_holds_there_as_its_glyph() {
    let temp = tempfile::tempdir().unwrap();

    let drawn = static_dollars(temp.path()).map_err(|error| error.to_string());

    // Regular draws dollar itself; Black draws dollar.heavy under dollar's name.
    assert_eq!(
        drawn,
        Ok(vec![
            ("dollar".to_string(), 100.0, 500.0),
            ("dollar".to_string(), 300.0, 650.0)
        ])
    );
}

/// The glyph `$` maps to in each static instance of [`heavy_dollar_font`]
/// exported into `directory`, as [`mapped_glyph`] reads it.
fn static_dollars(directory: &Path) -> Fixture<Vec<(String, f64, f32)>> {
    let written = FontExporter::new().export_static_instances_with(
        &heavy_dollar_font()?,
        directory,
        &BinaryEncodings::ttf(),
    )?;
    written
        .iter()
        .map(|result| mapped_glyph(&std::fs::read(&result.path)?, '$'))
        .collect()
}

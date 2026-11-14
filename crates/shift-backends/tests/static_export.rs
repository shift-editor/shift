//! Static instances compile to what the variable font is at each named
//! instance: the same outlines, advances and kerning, measured in the
//! compiled binaries.

mod support;

use std::path::Path;
use std::str::FromStr;

use harfrust::{Feature, ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer, Variation};
use kurbo::{BezPath, ParamCurve, ParamCurveNearest, PathSeg};
use shift_backends::{ExportError, FontExporter, StaticInstanceFile};
use shift_font::test_support::sample_variable_font;
use shift_font::{Font, NamedInstance};
use skrifa::outline::{DrawSettings, OutlinePen};
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

/// A glyph's outline as a path.
#[derive(Default)]
struct Outline(BezPath);

impl OutlinePen for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to((f64::from(x), f64::from(y)));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to((f64::from(x), f64::from(y)));
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.quad_to(
            (f64::from(cx0), f64::from(cy0)),
            (f64::from(x), f64::from(y)),
        );
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.curve_to(
            (f64::from(cx0), f64::from(cy0)),
            (f64::from(cx1), f64::from(cy1)),
            (f64::from(x), f64::from(y)),
        );
    }
    fn close(&mut self) {
        self.0.close_path();
    }
}

/// The farthest any point of `from`, sampled along each segment, lies from
/// the nearest point of `to`.
fn farthest_from(from: &BezPath, to: &BezPath) -> f64 {
    let targets: Vec<PathSeg> = to.segments().collect();
    from.segments()
        .flat_map(|segment| (0..=8).map(move |step| segment.eval(f64::from(step) / 8.0)))
        .map(|point| {
            targets
                .iter()
                .map(|target| target.nearest(point, 1e-3).distance_sq.sqrt())
                .fold(f64::INFINITY, f64::min)
        })
        .fold(0.0, f64::max)
}

/// How far apart two outlines run at most, measured both ways.
fn outline_distance(a: &BezPath, b: &BezPath) -> f64 {
    farthest_from(a, b).max(farthest_from(b, a))
}

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
    let written = exporter.export_static_instances(font, directory)?;
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

    let result = FontExporter::new().export_static_instances(&font, temp.path());

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

//! A font made in Shift (masters without filenames, custom uppercase axes,
//! components in every master, named instances) exported as sources and read
//! back keeps everything the sources can carry.

use std::path::Path;

use shift_backends::formats::designspace::DesignspaceReader;
use shift_backends::formats::ufo::UfoReader;
use shift_backends::{ExportError, ExportFormat, FontExportRequest, FontExporter, FontReader};
use shift_font::{
    Anchor, Axis, AxisMapping, AxisMappingPoint, Component, Contour, DecomposedTransform,
    DesignLocation, ExternalLocation, Font, Glyph, GlyphLayer, KerningGroup, KerningGroupId,
    KerningPair, KerningPosition, KerningSide, LayerId, Location, NamedInstance, PointType, Source,
    SourceId, StandardMetrics,
};

use super::Fixture;
use super::summary::FontSummary;

/// A dot-matrix family like Solenoid: a custom `RESO` and `BLED` axis beside a
/// mapped width axis, three masters, glyphs built from a `dot` component.
fn dot_matrix_font() -> Fixture<Font> {
    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Solenoid".to_string());

    let resolution = Axis::new("RESO".to_string(), "Resolution".to_string(), 4.0, 8.0, 16.0);
    let width = Axis::new("wdth".to_string(), "Width".to_string(), 75.0, 100.0, 125.0);
    let bleed = Axis::new("BLED".to_string(), "Bleed".to_string(), 0.0, 0.0, 100.0);
    let (reso, wdth, bled) = (resolution.id(), width.id(), bleed.id());
    font.add_axis(resolution)?;
    font.add_axis(width)?;
    font.add_axis(bleed)?;
    let width_point = |user: f64, design: f64| AxisMappingPoint {
        description: None,
        input: Location::from([(wdth, user)]),
        output: Location::from([(wdth, design)]),
    };
    font.set_axis_mappings(vec![AxisMapping::new(
        "Width".to_string(),
        vec![wdth],
        vec![wdth],
        vec![
            width_point(75.0, 50.0),
            width_point(100.0, 100.0),
            width_point(125.0, 150.0),
        ],
    )])?;

    let regular = font
        .default_source_id()
        .ok_or("a new font has a default source")?;
    font.source_mut(regular)
        .ok_or("the default source is in the font")?
        .set_location(DesignLocation::from([
            (reso, 8.0),
            (wdth, 100.0),
            (bled, 0.0),
        ]));
    let coarse = font.add_source(Source::new(
        "Coarse".to_string(),
        DesignLocation::from([(reso, 4.0), (wdth, 100.0), (bled, 0.0)]),
    ));
    let wide_bled = font.add_source(Source::new(
        "Wide Bled".to_string(),
        DesignLocation::from([(reso, 8.0), (wdth, 150.0), (bled, 100.0)]),
    ));
    let masters = [(regular, 1.0), (coarse, 2.0), (wide_bled, 1.5)];
    add_glyphs_and_kerning(&mut font, &masters)?;

    font.set_named_instances(vec![
        NamedInstance::new(
            "Regular".to_string(),
            ExternalLocation::from([(reso, 8.0), (wdth, 100.0), (bled, 0.0)]),
            Some("Solenoid-Regular".to_string()),
        ),
        NamedInstance::new(
            "Coarse Condensed".to_string(),
            ExternalLocation::from([(reso, 4.0), (wdth, 75.0), (bled, 0.0)]),
            None,
        ),
    ])?;

    Ok(font)
}

/// Gives every master in `masters` (each with a scale for its outlines)
/// standard metrics, the `dot`, `acutecomb`, `A` and `space` glyphs, and
/// group and glyph kerning.
fn add_glyphs_and_kerning(font: &mut Font, masters: &[(SourceId, f64)]) -> Fixture<()> {
    for (index, (source, _)) in masters.iter().enumerate() {
        let lift = f64::from(u8::try_from(index)?) * 10.0;
        font.set_standard_metrics(
            *source,
            StandardMetrics {
                ascender: Some(800.0 + lift),
                descender: Some(-200.0 - lift),
                cap_height: Some(700.0 + lift),
                x_height: Some(500.0 + lift),
                baseline: Some(0.0),
            },
        )?;
    }

    let mut dot = Glyph::new("dot");
    let mut acute = Glyph::with_unicode("acutecomb", 0x0301);
    for &(source, scale) in masters {
        dot.set_layer(dot_layer(source, scale));
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 0.0);
        layer.add_anchor(Anchor::new(Some("_top".to_string()), 50.0, 500.0));
        layer.add_anchor(Anchor::new(Some("top".to_string()), 50.0, 700.0));
        acute.set_layer(layer);
    }
    let dot_id = font.insert_glyph(dot)?;
    let acute_id = font.insert_glyph(acute)?;

    let mut letter = Glyph::with_unicode("A", 0x41);
    let mut space = Glyph::with_unicode("space", 0x20);
    space.add_unicode(0xA0);
    for &(source, scale) in masters {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source, 600.0 * scale);
        for (column, row) in [(0.0, 0.0), (1.0, 1.0), (2.0, 0.0)] {
            let mut component = Component::new(dot_id, "dot");
            component.translate(column * 200.0 * scale, row * 350.0);
            layer.add_component(component);
        }
        let mut scaled = DecomposedTransform::identity();
        scaled.scale_x = 0.5;
        scaled.scale_y = 2.0;
        scaled.translate_x = 250.0;
        layer.add_component(Component::with_transform(dot_id, "dot", scaled));
        layer.add_anchor(Anchor::new(Some("top".to_string()), 300.0 * scale, 700.0));
        letter.set_layer(layer);
        space.set_layer(GlyphLayer::with_width(
            LayerId::new(),
            source,
            250.0 * scale,
        ));
    }
    let letter_id = font.insert_glyph(letter)?;
    font.insert_glyph(space)?;

    let first = KerningGroupId::from_raw("first_A");
    font.kerning_mut().set_group(
        first,
        KerningGroup::new(KerningPosition::First, "A", vec![letter_id]),
    )?;
    for (index, &(source, _)) in masters.iter().enumerate() {
        let value = -20.0 - f64::from(u8::try_from(index)?) * 10.0;
        let kerning = font.kerning_mut();
        kerning.set_value(
            source,
            KerningPair::new(KerningSide::Group(first), KerningSide::Glyph(acute_id)),
            value,
        );
        kerning.set_value(
            source,
            KerningPair::glyphs(letter_id, letter_id),
            value / 2.0,
        );
    }
    Ok(())
}

/// A square dot with one curved corner, so curve points and smooth flags travel too.
fn dot_layer(source: SourceId, scale: f64) -> GlyphLayer {
    let size = 100.0 * scale;
    let mut layer = GlyphLayer::with_width(LayerId::new(), source, size);
    let mut contour = Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    contour.add_point(size, 0.0, PointType::OnCurve, false);
    contour.add_point(size, size / 2.0, PointType::OnCurve, true);
    contour.add_point(size, size, PointType::OffCurve, false);
    contour.add_point(size / 2.0, size, PointType::OffCurve, false);
    contour.add_point(0.0, size, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    layer
}

fn export_as(font: &Font, path: &Path, format: ExportFormat) -> Result<(), ExportError> {
    FontExporter::new()
        .export(
            font,
            FontExportRequest {
                path: path.to_path_buf(),
                format,
            },
        )
        .map(|_| ())
}

fn read_designspace(path: &Path) -> Fixture<Font> {
    let path = path.to_str().ok_or("temp paths are UTF-8")?;
    Ok(DesignspaceReader::new().load(path)?)
}

/// Fails naming every field that did not survive, when any did not.
fn assert_same(read: &Font, exported: &Font) -> Fixture<()> {
    let differences = FontSummary::of(read).differences(&FontSummary::of(exported));
    if differences.is_empty() {
        return Ok(());
    }
    Err(differences.join("\n").into())
}

#[test]
fn designspace_export_of_a_font_made_in_shift_reads_back_unchanged() -> Fixture<()> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("Solenoid.designspace");
    let font = dot_matrix_font()?;

    export_as(&font, &path, ExportFormat::Designspace)?;

    assert_same(&read_designspace(&path)?, &font)
}

#[test]
fn designspace_export_writes_one_ufo_per_master_named_after_it() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Solenoid.designspace");

    export_as(
        &dot_matrix_font().unwrap(),
        &path,
        ExportFormat::Designspace,
    )
    .unwrap();

    let mut written = Vec::new();
    for entry in std::fs::read_dir(temp.path()).unwrap() {
        written.push(entry.unwrap().file_name().to_string_lossy().into_owned());
    }
    written.sort();
    assert_eq!(
        written,
        [
            "Solenoid-Coarse.ufo",
            "Solenoid-Wide Bled.ufo",
            "Solenoid.designspace",
            "Solenoid.ufo",
        ]
    );
}

#[test]
fn designspace_export_twice_reads_back_the_same_font() -> Fixture<()> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("Solenoid.designspace");
    let font = dot_matrix_font()?;

    export_as(&font, &path, ExportFormat::Designspace)?;
    let first = read_designspace(&path)?;
    export_as(&first, &path, ExportFormat::Designspace)?;

    assert_same(&read_designspace(&path)?, &font)
}

#[test]
fn ufo_export_of_a_single_master_font_reads_back_unchanged() -> Fixture<()> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("Solenoid.ufo");
    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Solenoid".to_string());
    let regular = font
        .default_source_id()
        .ok_or("a new font has a default source")?;
    add_glyphs_and_kerning(&mut font, &[(regular, 1.0)])?;

    export_as(&font, &path, ExportFormat::Ufo)?;

    let read = UfoReader::new().load(path.to_str().ok_or("temp paths are UTF-8")?)?;
    assert_same(&read, &font)
}

/// Whether an export error is the refusal a case expects.
type IsRefusal = fn(&ExportError) -> bool;

#[test]
fn export_refuses_a_ufo_of_several_masters_or_a_path_for_another_format() {
    let font = dot_matrix_font().unwrap();
    let refusals: [(ExportFormat, IsRefusal); 2] = [
        (ExportFormat::Ufo, |error| {
            matches!(error, ExportError::UfoNeedsOneMaster { master_count: 3 })
        }),
        (ExportFormat::Designspace, |error| {
            matches!(
                error,
                ExportError::OutputExtensionMismatch {
                    format: ExportFormat::Designspace,
                    ..
                }
            )
        }),
    ];

    for (format, refused) in refusals {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("Solenoid.ufo");

        let result = export_as(&font, &path, format);

        assert!(
            result.as_ref().is_err_and(refused),
            "{format:?} export to a .ufo path: {result:?}"
        );
        assert!(!path.exists());
    }
}

#[test]
fn export_format_follows_the_path_extension() {
    let format = |path: &str| ExportFormat::from_path(Path::new(path)).ok();

    assert_eq!(
        format("a/Solenoid.designspace"),
        Some(ExportFormat::Designspace)
    );
    assert_eq!(format("Solenoid.UFO"), Some(ExportFormat::Ufo));
    assert_eq!(format("Solenoid.ttf"), Some(ExportFormat::Ttf));
    assert_eq!(format("Solenoid.glyphs"), None);
    assert_eq!(format("Solenoid"), None);
}

#[test]
fn exporting_into_a_folder_that_does_not_exist_yet_creates_it() {
    let font = dot_matrix_font().unwrap();

    for format in [ExportFormat::Ttf, ExportFormat::Designspace] {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("new").join("exports");
        let request = FontExporter::request_in(&font, format, &folder);
        let path = request.path.clone();

        FontExporter::new().export(&font, request).unwrap();

        assert!(path.exists(), "{format:?} export wrote {}", path.display());
    }
}

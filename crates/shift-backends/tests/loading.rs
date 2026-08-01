use std::{
    fs,
    path::{Path, PathBuf},
};

use shift_backends::font_loader::FontLoader;
use shift_font::{Contour, Font, Glyph, GlyphLayer, LayerId, MetricKind, PointType};

fn fixtures_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures")
}

fn copy_directory(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &destination_path);
        } else {
            fs::copy(entry.path(), destination_path).unwrap();
        }
    }
}

fn mutatorsans_ufo_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSansLightCondensed.ufo")
}

fn mutatorsans_ttf_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSans.ttf")
}

fn mutatorsans_otf_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans/MutatorSans.otf")
}

fn host_grotesk_variable_ttf_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("apps/desktop/src/renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf")
}

fn homenaje_glyphs_path() -> PathBuf {
    fixtures_path().join("fonts/Homenaje.glyphs")
}

fn mutatorsans_variable_glyphs_path() -> PathBuf {
    fixtures_path().join("fonts/MutatorSansVariable.glyphs")
}

fn mutatorsans_designspace_path() -> PathBuf {
    fixtures_path().join("fonts/mutatorsans-variable/MutatorSans.designspace")
}

fn load_font(path: &Path) -> Font {
    assert!(path.exists(), "missing font fixture at {}", path.display());
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()))
}

fn stream_font(path: &Path) -> Font {
    let import = FontLoader::new()
        .stream_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to stream {}: {error}", path.display()));
    assert_eq!(import.header().glyph_count(), 0);
    let directory = import.directory();
    let expected_count = import.glyph_count();
    assert_eq!(directory.len(), expected_count);
    let font = import.collect_font().unwrap();
    assert_eq!(font.glyph_count(), expected_count);
    for entry in directory {
        assert_eq!(
            font.glyph(entry.glyph_id).map(Glyph::glyph_name),
            Some(&entry.name)
        );
    }
    font
}

fn main_layer(glyph: &Glyph) -> &GlyphLayer {
    glyph
        .layers()
        .values()
        .max_by_key(|layer| layer.contours().len())
        .expect("glyph should have at least one layer")
}

fn simple_geometry_font() -> Font {
    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_unicode("A".to_string(), 0x0041);
    let mut layer = GlyphLayer::with_width(LayerId::from_raw("A_regular"), source_id, 640.0);
    let mut contour = Contour::new();
    contour.add_point(100.0, 0.0, PointType::OnCurve, false);
    contour.add_point(320.0, 700.0, PointType::OnCurve, false);
    contour.add_point(540.0, 0.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    glyph.set_layer(layer);
    font.insert_glyph(glyph).unwrap();
    font
}

#[test]
fn loads_ufo_metadata_metrics_and_geometry() {
    let font = load_font(&mutatorsans_ufo_path());
    let metadata = font.metadata();
    let metrics = font.metrics();

    assert_eq!(font.glyph_count(), 48);
    assert_eq!(metadata.family_name.as_deref(), Some("MutatorMathTest"));
    assert_eq!(metadata.style_name.as_deref(), Some("LightCondensed"));
    assert_eq!(metrics.units_per_em, 1000.0);
    let source_id = font.default_source_id().unwrap();
    assert_eq!(
        font.metric_value(source_id.clone(), MetricKind::Ascender)
            .unwrap()
            .position,
        700.0
    );
    assert_eq!(
        font.metric_value(source_id.clone(), MetricKind::Descender)
            .unwrap()
            .position,
        -200.0
    );
    assert_eq!(
        font.metric_value(source_id.clone(), MetricKind::CapHeight)
            .unwrap()
            .position,
        700.0
    );
    assert_eq!(
        font.metric_value(source_id, MetricKind::XHeight)
            .unwrap()
            .position,
        500.0
    );

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    assert!(!main_layer(glyph_a).contours().is_empty());

    let glyph_o = font.glyph_by_name("O").expect("O glyph should exist");
    let has_off_curve = main_layer(glyph_o)
        .contours_iter()
        .flat_map(|contour| contour.points())
        .any(|point| point.point_type() == PointType::OffCurve);
    assert!(has_off_curve, "O should contain curve control points");
}

#[test]
fn loads_ufo_components_anchors_layers_and_kerning() {
    let font = load_font(&mutatorsans_ufo_path());

    let aacute = font
        .glyph_by_name("Aacute")
        .expect("Aacute glyph should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph_name().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let e = font.glyph_by_name("E").expect("E glyph should exist");
    let anchor_names: Vec<_> = e
        .layers()
        .values()
        .flat_map(|layer| layer.anchors_iter())
        .filter_map(|anchor| anchor.name())
        .collect();
    assert!(anchor_names.contains(&"top"));

    let source_names: Vec<_> = font.sources().iter().map(|source| source.name()).collect();
    assert!(source_names.contains(&"Regular"));
    assert!(font.sources().len() >= 2);
    assert!(font
        .glyphs()
        .flat_map(|glyph| glyph.layers().values())
        .all(|layer| font
            .sources()
            .iter()
            .any(|source| source.id() == layer.source_id())));

    assert_eq!(font.kerning().get_kerning("T", "A"), Some(-75.0));
    assert_eq!(font.kerning().get_kerning("V", "A"), Some(-100.0));
}

#[test]
fn loads_binary_fonts_with_contours() {
    for path in [mutatorsans_ttf_path(), mutatorsans_otf_path()] {
        let font = load_font(&path);
        let glyph_a = font
            .glyphs_by_unicode(65)
            .next()
            .unwrap_or_else(|| panic!("{} should contain U+0041", path.display()));

        assert!(font.glyph_count() > 0);
        assert!(!main_layer(glyph_a).contours().is_empty());
    }
}

#[test]
fn streams_binary_ufo_and_designspace_without_eager_glyphs() {
    let binary_path = mutatorsans_ttf_path();
    let binary_bytes = std::fs::read(&binary_path).unwrap();
    let binary = skrifa::FontRef::new(&binary_bytes).unwrap();
    let expected_binary_glyphs = skrifa::raw::TableProvider::maxp(&binary)
        .unwrap()
        .num_glyphs() as usize;
    let streamed_binary = stream_font(&binary_path);
    assert_eq!(streamed_binary.glyph_count(), expected_binary_glyphs);

    for path in [binary_path, mutatorsans_ufo_path()] {
        let eager = load_font(&path);
        let streamed = stream_font(&path);
        assert_eq!(streamed.glyph_count(), eager.glyph_count());
        let glyph_a = streamed
            .glyphs_by_unicode(65)
            .next()
            .unwrap_or_else(|| panic!("{} should stream U+0041", path.display()));
        assert!(!main_layer(glyph_a).contours().is_empty());
    }

    let path = mutatorsans_designspace_path();
    let eager = load_font(&path);
    let streamed = stream_font(&path);
    assert_eq!(streamed.glyph_count(), eager.glyph_count());
    assert_eq!(streamed.axes().len(), eager.axes().len());
    assert_eq!(streamed.sources().len(), eager.sources().len());
    assert_eq!(
        streamed
            .glyphs()
            .map(Glyph::name)
            .collect::<std::collections::BTreeSet<_>>(),
        eager
            .glyphs()
            .map(Glyph::name)
            .collect::<std::collections::BTreeSet<_>>()
    );
}

#[test]
fn ufo_import_keeps_nondefault_layer_order_when_default_was_not_first() {
    let temp = tempfile::tempdir().unwrap();
    let ufo_path = temp.path().join("Reordered.ufo");
    copy_directory(&mutatorsans_ufo_path(), &ufo_path);
    let layercontents_path = ufo_path.join("layercontents.plist");
    let mut layercontents = plist::Value::from_file(&layercontents_path).unwrap();
    let layers = layercontents.as_array_mut().unwrap();
    let default = layers.remove(0);
    layers.insert(2, default);
    layercontents.to_file_xml(&layercontents_path).unwrap();

    let font = load_font(&ufo_path);
    let source_names = font
        .sources()
        .iter()
        .map(|source| source.name().to_string())
        .collect::<Vec<_>>();

    assert_eq!(
        &source_names[..3],
        &["Regular", "support", "support.crossbar"]
    );
}

#[test]
fn streaming_batches_preserve_published_directory_order() {
    for path in [
        mutatorsans_ttf_path(),
        mutatorsans_ufo_path(),
        mutatorsans_designspace_path(),
    ] {
        let mut import = FontLoader::new()
            .stream_font(path.to_str().unwrap())
            .unwrap();
        let expected = import
            .directory()
            .into_iter()
            .map(|entry| (entry.glyph_id, entry.name))
            .collect::<Vec<_>>();
        let mut actual = Vec::new();
        loop {
            let batch = import
                .next_batch(shift_backends::ImportBatchLimit::new(7, 20))
                .unwrap();
            if batch.is_empty() {
                break;
            }
            actual.extend(
                batch
                    .into_iter()
                    .map(|glyph| (glyph.id(), glyph.glyph_name().clone())),
            );
        }

        assert_eq!(
            actual,
            expected,
            "stream order changed for {}",
            path.display()
        );
    }
}

#[test]
fn streaming_batches_bound_authored_layers_across_sources() {
    let path = mutatorsans_designspace_path();
    let mut import = FontLoader::new()
        .stream_font(path.to_str().unwrap())
        .unwrap();
    let glyphs = import
        .next_batch(shift_backends::ImportBatchLimit::new(512, 4))
        .unwrap();
    let layer_count = glyphs
        .iter()
        .map(|glyph| glyph.layers().len())
        .sum::<usize>();

    assert!(!glyphs.is_empty());
    assert!(glyphs.len() < import.glyph_count());
    assert!(layer_count <= 4 || glyphs.len() == 1);
}

#[test]
fn loads_binary_variable_axes_and_named_instances() {
    let font = load_font(&host_grotesk_variable_ttf_path());

    assert!(font.is_variable());
    assert_eq!(font.axes().len(), 1);
    let weight = &font.axes()[0];
    assert_eq!(weight.tag(), "wght");
    assert_eq!(weight.name(), "Weight");
    assert_eq!(weight.minimum(), 300.0);
    assert_eq!(weight.default(), 300.0);
    assert_eq!(weight.maximum(), 800.0);
    assert!(!weight.is_hidden());
    assert_eq!(
        font.default_source()
            .expect("binary font should have a default source")
            .location()
            .get(&weight.id()),
        Some(300.0)
    );

    assert_eq!(font.named_instances().len(), 6);
    let regular = font
        .named_instances()
        .iter()
        .find(|instance| instance.name() == "Regular")
        .expect("Host Grotesk should contain a Regular instance");
    assert_eq!(regular.location().get(&weight.id()), Some(400.0));
    assert_eq!(regular.postscript_name(), Some("HostGrotesk-Regular"));
}

fn assert_curve_point_runs(contour: &Contour, context: &str) {
    let points = contour.points();
    assert!(!points.is_empty(), "empty contour in {context}");
    assert!(
        points[0].is_on_curve(),
        "contour should start with an on-curve point in {context}"
    );

    let mut off_run = 0;
    for point in &points[1..] {
        match point.point_type() {
            PointType::OffCurve => off_run += 1,
            PointType::OnCurve => {
                assert!(
                    off_run == 0 || off_run == 2,
                    "on-curve point preceded by {off_run} off-curves in {context}"
                );
                off_run = 0;
            }
            PointType::QCurve => {
                assert_eq!(
                    off_run, 1,
                    "qcurve point preceded by {off_run} off-curves in {context}"
                );
                off_run = 0;
            }
        }
    }

    if contour.is_closed() {
        let first = &points[0];
        match first.point_type() {
            PointType::QCurve => assert_eq!(
                off_run, 1,
                "closing qcurve has {off_run} off-curves in {context}"
            ),
            PointType::OnCurve => assert!(
                off_run == 0 || off_run == 2,
                "closing segment has {off_run} off-curves in {context}"
            ),
            PointType::OffCurve => unreachable!("first point is known to be on-curve"),
        }
        let last = &points[points.len() - 1];
        assert!(
            points.len() == 1
                || !(last.is_on_curve() && last.x() == first.x() && last.y() == first.y()),
            "closed contour duplicates its start point in {context}"
        );
    } else {
        assert_eq!(
            off_run, 0,
            "open contour ends with {off_run} dangling off-curves in {context}"
        );
    }
}

#[test]
fn binary_import_produces_valid_curve_point_runs() {
    for path in [mutatorsans_ttf_path(), mutatorsans_otf_path()] {
        let font = load_font(&path);
        let mut curve_contours = 0;
        for glyph in font.glyphs() {
            for layer in glyph.layers().values() {
                for contour in layer.contours_iter() {
                    let context = format!("glyph '{}' in {}", glyph.name(), path.display());
                    assert_curve_point_runs(contour, &context);
                    if contour
                        .points()
                        .iter()
                        .any(|point| point.point_type() == PointType::OffCurve)
                    {
                        curve_contours += 1;
                    }
                }
            }
        }
        assert!(
            curve_contours > 0,
            "{} should import contours with curve segments",
            path.display()
        );
    }
}

#[test]
fn binary_font_missing_hmtx_returns_error_instead_of_panicking() {
    let mut bytes = std::fs::read(mutatorsans_ttf_path()).unwrap();

    // Rename the hmtx tag in the table directory so the table lookup fails
    // while the rest of the font stays parseable.
    let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
    let record_offset = (0..num_tables)
        .map(|index| 12 + index * 16)
        .find(|&offset| &bytes[offset..offset + 4] == b"hmtx")
        .expect("fixture should contain an hmtx table");
    bytes[record_offset..record_offset + 4].copy_from_slice(b"zzzz");

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("missing-hmtx.ttf");
    std::fs::write(&path, bytes).unwrap();

    let error = FontLoader::new()
        .read_font(path.to_str().unwrap())
        .expect_err("font without hmtx should fail to load");
    assert!(
        error.to_string().contains("hmtx"),
        "unexpected error: {error}"
    );
}

#[test]
fn truncated_binary_font_returns_error_instead_of_panicking() {
    let bytes = std::fs::read(mutatorsans_ttf_path()).unwrap();

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("truncated.ttf");
    std::fs::write(&path, &bytes[..200]).unwrap();

    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .expect_err("truncated font should fail to load");
}

#[test]
fn loads_glyphs_file_features_kerning_components_and_anchors() {
    let font = load_font(&homenaje_glyphs_path());

    assert_eq!(font.metadata().family_name.as_deref(), Some("Homenaje"));
    assert_eq!(font.metrics().units_per_em, 1000.0);
    let source_id = font.default_source_id().unwrap();
    assert_eq!(
        font.metric_value(source_id.clone(), MetricKind::Ascender)
            .unwrap()
            .position,
        700.0
    );
    assert_eq!(
        font.metric_value(source_id, MetricKind::Descender)
            .unwrap()
            .position,
        -160.0
    );
    assert!(font.glyph_count() >= 300);

    let fea = font
        .features()
        .fea_source()
        .expect("Homenaje should include feature source");
    assert!(fea.contains("feature locl"));
    assert!(fea.contains("feature frac"));
    assert!(fea.contains("feature ordn"));

    assert_eq!(font.kerning().get_kerning("A", "V"), Some(-55.0));
    assert_eq!(font.kerning().get_kerning("V", "a"), Some(-65.0));

    let aacute = font
        .glyph_by_name("Aacute")
        .expect("Aacute glyph should exist");
    let component_bases: Vec<_> = main_layer(aacute)
        .components_iter()
        .map(|component| component.base_glyph_name().as_str())
        .collect();
    assert_eq!(component_bases.len(), 2);
    assert!(component_bases.contains(&"A"));
    assert!(component_bases.contains(&"acute"));

    let u = font.glyph_by_name("u").expect("u glyph should exist");
    let anchor_names: Vec<_> = main_layer(u)
        .anchors_iter()
        .filter_map(|anchor| anchor.name())
        .collect();
    assert!(anchor_names.contains(&"top"));
    assert!(anchor_names.contains(&"bottom"));
    assert!(anchor_names.contains(&"ogonek"));
}

#[test]
fn loads_variable_glyphs_sources_and_compatible_layers() {
    let font = load_font(&mutatorsans_variable_glyphs_path());

    assert!(font.is_variable());
    assert_eq!(font.axes().len(), 1);
    assert_eq!(font.axes()[0].tag(), "wght");
    assert_eq!(font.axes()[0].minimum(), 100.0);
    assert_eq!(font.axes()[0].maximum(), 900.0);
    assert_eq!(font.sources().len(), 2);
    let weight_axis_id = font.axis_id_by_tag("wght").expect("wght axis id");
    assert_eq!(
        font.sources()[0].location().get(&weight_axis_id),
        Some(100.0)
    );
    assert_eq!(
        font.sources()[1].location().get(&weight_axis_id),
        Some(900.0)
    );

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    let layers: Vec<_> = glyph_a.layers().values().collect();
    assert_eq!(layers.len(), 2);
    assert_eq!(layers[0].contours().len(), layers[1].contours().len());
    assert_eq!(
        layers[0]
            .contours()
            .values()
            .map(|contour| contour.points().len())
            .sum::<usize>(),
        layers[1]
            .contours()
            .values()
            .map(|contour| contour.points().len())
            .sum::<usize>()
    );
}

#[test]
fn loads_designspace_sources_axes_and_default_metadata() {
    let font = load_font(&mutatorsans_designspace_path());

    assert!(font.is_variable());
    assert_eq!(
        font.metadata().family_name.as_deref(),
        Some("MutatorMathTest")
    );
    assert!(font.glyph_count() > 10);
    assert_eq!(font.axes().len(), 2);
    assert_eq!(font.axes()[0].tag(), "wdth");
    assert_eq!(font.axes()[1].tag(), "wght");
    assert_eq!(font.sources().len(), 7);
    let width_axis_id = font.axis_id_by_tag("wdth").expect("wdth axis id");
    let weight_axis_id = font.axis_id_by_tag("wght").expect("wght axis id");
    assert_eq!(font.sources()[0].location().get(&width_axis_id), Some(0.0));
    assert_eq!(font.sources()[0].location().get(&weight_axis_id), Some(0.0));
    assert!(font.sources()[0].filename().is_some());
    let bold_condensed = font
        .sources()
        .iter()
        .find(|source| {
            source.filename() == Some("MutatorSansBoldCondensed.ufo")
                && source.layer_name().is_none()
        })
        .expect("non-default Bold Condensed master should be imported");
    assert_eq!(
        font.metric_value(bold_condensed.id(), MetricKind::Ascender)
            .expect("non-default master ascender should survive import")
            .position,
        800.0
    );
    assert_eq!(font.named_instances().len(), 14);
    let medium_wide = font
        .named_instances()
        .iter()
        .find(|instance| instance.name() == "Medium_Wide_I")
        .expect("valid instance with a conflicting PostScript name should remain available");
    assert_eq!(medium_wide.postscript_name(), None);
    assert!(font
        .named_instances()
        .iter()
        .all(|instance| !matches!(instance.name(), "Extrapolate" | "Anisotropic_Extrapolate")));

    let glyph_a = font.glyph_by_name("A").expect("A glyph should exist");
    assert!(glyph_a.layers().len() >= 4);
}

#[test]
fn round_trips_shift_source_through_font_loader() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Dogfood.shift");
    let original = simple_geometry_font();

    FontLoader::new()
        .write_font(&original, path.to_str().unwrap())
        .unwrap();
    let loaded = load_font(&path);

    let glyph = loaded.glyph_by_name("A").expect("A glyph should exist");
    let layer = main_layer(glyph);

    assert_eq!(glyph.unicodes(), &[0x0041]);
    assert_eq!(layer.width(), 640.0);
    assert_eq!(layer.contours().len(), 1);
    assert!(layer.contours().values().next().unwrap().is_closed());
    assert_eq!(layer.contours().values().next().unwrap().points().len(), 3);
}

use std::path::{Path, PathBuf};

use norad::designspace::{Axis as DsAxis, DesignSpaceDocument, Dimension, Source as DsSource};
use shift_backends::font_loader::FontLoader;
use shift_font::Font;

fn load_font(path: &Path) -> Font {
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to load {}: {error}", path.display()))
}

fn save_font(font: &Font, path: &Path) {
    FontLoader::new()
        .write_font(font, path.to_str().unwrap())
        .unwrap_or_else(|error| panic!("failed to save {}: {error}", path.display()));
}

fn triangle_glyph(name: &str, width: f64, peak_y: f64) -> norad::Glyph {
    let mut glyph = norad::Glyph::new(name);
    glyph.width = width;
    glyph.codepoints.insert('A');
    glyph.contours.push(norad::Contour::new(
        vec![
            norad::ContourPoint::new(0.0, 0.0, norad::PointType::Line, false, None, None),
            norad::ContourPoint::new(
                width / 2.0,
                peak_y,
                norad::PointType::Line,
                false,
                None,
                None,
            ),
            norad::ContourPoint::new(width, 0.0, norad::PointType::Line, false, None, None),
        ],
        None,
    ));
    glyph
}

fn master_ufo(dir: &Path, filename: &str, style: &str, width: f64, peak_y: f64) -> PathBuf {
    let mut font = norad::Font::new();
    font.font_info.family_name = Some("Grouped".to_string());
    font.font_info.style_name = Some(style.to_string());
    font.font_info.units_per_em = Some(1000_u32.into());
    font.font_info.ascender = Some(800.0);
    font.font_info.descender = Some(-200.0);
    font.layers
        .default_layer_mut()
        .insert_glyph(triangle_glyph("A", width, peak_y));

    let path = dir.join(filename);
    font.save(&path).expect("fixture UFO should save");
    path
}

fn weight_dimension(value: f32) -> Dimension {
    Dimension {
        name: "Weight".to_string(),
        xvalue: Some(value),
        ..Default::default()
    }
}

fn ds_source(style: &str, filename: &str, layer: Option<&str>, weight: f32) -> DsSource {
    DsSource {
        familyname: Some("Grouped".to_string()),
        stylename: Some(style.to_string()),
        name: Some(style.to_string()),
        filename: filename.to_string(),
        layer: layer.map(str::to_string),
        location: vec![weight_dimension(weight)],
    }
}

/// A designspace spread over two master UFOs, with an intermediate master
/// declared as a layer of the bold UFO.
fn multi_ufo_designspace(dir: &Path) -> PathBuf {
    master_ufo(dir, "Grouped-Light.ufo", "Light", 400.0, 600.0);
    let bold_path = master_ufo(dir, "Grouped-Bold.ufo", "Bold", 700.0, 750.0);

    let mut bold = norad::Font::load(&bold_path).unwrap();
    let medium = bold.layers.new_layer("Medium").unwrap();
    medium.insert_glyph(triangle_glyph("A", 550.0, 675.0));
    bold.save(&bold_path).unwrap();

    let document = DesignSpaceDocument {
        format: 5.0,
        axes: vec![DsAxis {
            name: "Weight".to_string(),
            tag: "wght".to_string(),
            minimum: Some(300.0),
            default: 300.0,
            maximum: Some(700.0),
            ..Default::default()
        }],
        sources: vec![
            ds_source("Light", "Grouped-Light.ufo", None, 300.0),
            ds_source("Bold", "Grouped-Bold.ufo", None, 700.0),
            ds_source("Medium", "Grouped-Bold.ufo", Some("Medium"), 500.0),
        ],
        ..Default::default()
    };

    let path = dir.join("Grouped.designspace");
    document
        .save(&path)
        .expect("fixture designspace should save");
    path
}

/// (name, filename, layer name, weight location) per source.
type SourceShape = (String, Option<String>, Option<String>, Option<f64>);

fn source_shape(font: &Font) -> Vec<SourceShape> {
    let weight = font.axis_id_by_tag("wght").expect("wght axis should exist");
    font.sources()
        .iter()
        .map(|source| {
            (
                source.name().to_string(),
                source.filename().map(str::to_string),
                source.layer_name().map(str::to_string),
                source.location().get(&weight),
            )
        })
        .collect()
}

fn layer_width(font: &Font, source_name: &str, glyph_name: &str) -> f64 {
    let source = font
        .sources()
        .iter()
        .find(|source| source.name() == source_name)
        .unwrap_or_else(|| panic!("source {source_name} should exist"));
    font.glyph_by_name(glyph_name)
        .unwrap_or_else(|| panic!("glyph {glyph_name} should exist"))
        .layer_for_source(source.id())
        .unwrap_or_else(|| panic!("{glyph_name} should have a layer for {source_name}"))
        .width()
}

#[test]
fn multi_ufo_designspace_round_trips_file_structure_and_sources() {
    let fixture_dir = tempfile::tempdir().unwrap();
    let ds_path = multi_ufo_designspace(fixture_dir.path());
    let original = load_font(&ds_path);

    // Save under a different stem to prove filenames come from the stored
    // source filenames, not from the designspace path.
    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("Renamed.designspace");
    save_font(&original, &out_path);

    let mut entries: Vec<_> = std::fs::read_dir(out_dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    entries.sort();
    assert_eq!(
        entries,
        vec![
            "Grouped-Bold.ufo",
            "Grouped-Light.ufo",
            "Renamed.designspace"
        ],
        "the project must keep its original UFO files, not be restructured"
    );

    let saved = DesignSpaceDocument::load(&out_path).unwrap();
    let saved_shape: Vec<_> = saved
        .sources
        .iter()
        .map(|source| {
            (
                source.stylename.clone().unwrap(),
                source.filename.clone(),
                source.layer.clone(),
                source.location[0].xvalue.unwrap(),
            )
        })
        .collect();
    assert_eq!(
        saved_shape,
        vec![
            (
                "Light".to_string(),
                "Grouped-Light.ufo".to_string(),
                None,
                300.0
            ),
            (
                "Bold".to_string(),
                "Grouped-Bold.ufo".to_string(),
                None,
                700.0
            ),
            (
                "Medium".to_string(),
                "Grouped-Bold.ufo".to_string(),
                Some("Medium".to_string()),
                500.0
            ),
        ]
    );

    let saved_bold = norad::Font::load(out_dir.path().join("Grouped-Bold.ufo")).unwrap();
    assert_eq!(
        saved_bold
            .layers
            .default_layer()
            .get_glyph("A")
            .expect("Bold default layer should keep A")
            .width,
        700.0
    );
    assert_eq!(
        saved_bold
            .layers
            .get("Medium")
            .expect("Medium must stay a layer of the Bold UFO")
            .get_glyph("A")
            .expect("Medium layer should keep A")
            .width,
        550.0
    );

    let reloaded = load_font(&out_path);
    assert_eq!(source_shape(&reloaded), source_shape(&original));

    let axes: Vec<_> = reloaded
        .axes()
        .iter()
        .map(|axis| (axis.tag(), axis.minimum(), axis.default(), axis.maximum()))
        .collect();
    let original_axes: Vec<_> = original
        .axes()
        .iter()
        .map(|axis| (axis.tag(), axis.minimum(), axis.default(), axis.maximum()))
        .collect();
    assert_eq!(axes, original_axes);

    for source_name in ["Light", "Bold", "Medium"] {
        assert_eq!(
            layer_width(&reloaded, source_name, "A"),
            layer_width(&original, source_name, "A"),
            "glyph geometry for {source_name} should survive the round trip"
        );
    }
}

#[cfg(unix)]
#[test]
fn failed_save_leaves_existing_designspace_xml_intact() {
    use std::os::unix::fs::PermissionsExt;

    let fixture_dir = tempfile::tempdir().unwrap();
    let ds_path = multi_ufo_designspace(fixture_dir.path());
    let font = load_font(&ds_path);

    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("Grouped.designspace");
    save_font(&font, &out_path);
    let saved_xml = std::fs::read(&out_path).unwrap();

    // A read-only project directory makes every staged write fail before
    // any existing file is touched.
    std::fs::set_permissions(out_dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let result = FontLoader::new().write_font(&font, out_path.to_str().unwrap());
    std::fs::set_permissions(out_dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

    result.expect_err("saving into a read-only directory should fail");
    assert_eq!(
        std::fs::read(&out_path).unwrap(),
        saved_xml,
        "a failed save must leave the existing designspace XML intact"
    );
}

fn background_layer_ufo(dir: &Path) -> PathBuf {
    let mut font = norad::Font::new();
    font.font_info.family_name = Some("Layered".to_string());
    font.font_info.style_name = Some("Regular".to_string());
    font.font_info.units_per_em = Some(1000_u32.into());
    font.layers
        .default_layer_mut()
        .insert_glyph(triangle_glyph("A", 500.0, 700.0));

    let background = font.layers.new_layer("background").unwrap();
    background.insert_glyph(triangle_glyph("A", 500.0, 650.0));

    let path = dir.join("Layered.ufo");
    font.save(&path).expect("fixture UFO should save");
    path
}

#[test]
fn plain_ufo_layers_are_not_promoted_to_designspace_masters() {
    let fixture_dir = tempfile::tempdir().unwrap();
    let ufo_path = background_layer_ufo(fixture_dir.path());
    let font = load_font(&ufo_path);

    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("Layered.designspace");
    save_font(&font, &out_path);

    let xml = std::fs::read_to_string(&out_path).unwrap();
    assert_eq!(
        xml.matches("<source ").count(),
        1,
        "only the default master gets a <source> entry: {xml}"
    );
    assert!(
        !xml.contains("background"),
        "the background layer must not become a designspace source: {xml}"
    );

    let saved_ufo = norad::Font::load(out_dir.path().join("Layered.ufo")).unwrap();
    assert_eq!(
        saved_ufo
            .layers
            .get("background")
            .expect("background must survive as a UFO layer")
            .get_glyph("A")
            .expect("background A should survive")
            .width,
        500.0
    );
}

#[test]
fn plain_ufo_layers_stay_layers_when_axes_exist() {
    let fixture_dir = tempfile::tempdir().unwrap();
    let ufo_path = background_layer_ufo(fixture_dir.path());
    let mut font = load_font(&ufo_path);
    font.add_axis(shift_font::Axis::new(
        "wght".to_string(),
        "Weight".to_string(),
        300.0,
        400.0,
        700.0,
    ));

    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("Layered.designspace");
    save_font(&font, &out_path);

    let saved = DesignSpaceDocument::load(&out_path).unwrap();
    assert_eq!(saved.sources.len(), 1);
    assert_eq!(saved.sources[0].stylename.as_deref(), Some("Regular"));
    assert!(saved.axes.iter().any(|axis| axis.tag == "wght"));

    let saved_ufo = norad::Font::load(out_dir.path().join("Layered.ufo")).unwrap();
    assert!(
        saved_ufo.layers.get("background").is_some(),
        "background must stay a UFO layer"
    );
}

//! Kerning edits reach the compiled font: each master's value, a glyph
//! exception at one master, and a renamed group, measured by shaping.

use std::path::PathBuf;
use std::str::FromStr;

use harfrust::{Feature, ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer, Variation};
use shift_backends::font_loader::FontLoader;
use shift_backends::{ExportFormat, FontExportRequest, FontExporter};
use shift_font::{
    Font, FontIntent, FontIntentSet, KerningPair, KerningPosition, KerningSide, KerningValueEdit,
    SourceId,
};

fn mutatorsans() -> Font {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace");
    FontLoader::new()
        .read_font(path.to_str().unwrap())
        .expect("MutatorSans should load")
}

/// A master by its UFO, not one of the sparse support layers inside it.
fn master(font: &Font, filename: &str) -> SourceId {
    font.sources()
        .iter()
        .find(|source| source.filename() == Some(filename) && source.layer_name().is_none())
        .unwrap_or_else(|| panic!("no master for {filename}"))
        .id()
}

/// Width and weight of each corner master, in user units (the axes have no map).
const LIGHT_CONDENSED: (f32, f32) = (0.0, 0.0);
const BOLD_WIDE: (f32, f32) = (1000.0, 1000.0);

fn compile(font: &Font) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("MutatorSans.ttf");
    FontExporter::new()
        .export(
            font,
            FontExportRequest {
                path: path.clone(),
                format: ExportFormat::Ttf,
            },
        )
        .expect("MutatorSans should compile");
    std::fs::read(path).unwrap()
}

/// The kern the compiled font applies between the first two characters of
/// `text` at a (width, weight) location: the first glyph's advance with
/// kerning on, less its advance with kerning off.
fn kern_at(bytes: &[u8], text: &str, (width, weight): (f32, f32)) -> i32 {
    let font = harfrust::FontRef::new(bytes).expect("compiled font should parse");
    let data = ShaperData::new(&font);
    let instance = ShaperInstance::from_variations(
        &font,
        [
            Variation {
                tag: Tag::new(b"wdth"),
                value: width,
            },
            Variation {
                tag: Tag::new(b"wght"),
                value: weight,
            },
        ],
    );
    let shaper = data.shaper(&font).instance(Some(&instance)).build();
    let first_advance = |features: &[Feature]| {
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = shaper.shape(buffer, ShapeOptions::new().features(features));
        shaped.glyph_positions()[0].x_advance
    };
    let no_kern = [Feature::from_str("-kern").unwrap()];
    first_advance(&[]) - first_advance(&no_kern)
}

fn edit(font: &mut Font, intent: FontIntent) {
    font.apply_intents(FontIntentSet {
        intents: vec![intent],
    })
    .expect("kerning edit should apply");
}

#[test]
fn each_master_kerns_with_its_own_value() {
    let bytes = compile(&mutatorsans());

    assert_eq!(kern_at(&bytes, "TA", LIGHT_CONDENSED), -75);
    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), -150);
    // Halfway on both axes the four masters blend to -126.25 (as the editor shows).
    assert_eq!(kern_at(&bytes, "TA", (500.0, 500.0)), -126);
}

#[test]
fn an_exception_at_one_master_changes_only_that_pair_at_that_master() {
    let mut font = mutatorsans();
    let t = font.glyph_id_by_name("T").unwrap();
    let a = font.glyph_id_by_name("A").unwrap();
    let b = font.glyph_id_by_name("B").unwrap();
    let bold_wide = master(&font, "MutatorSansBoldWide.ufo");
    let a_group = font
        .kerning()
        .group_of(KerningPosition::Second, &a)
        .expect("A kerns through a group")
        .clone();

    // B joins A's group, so T kerns against both through it.
    edit(
        &mut font,
        FontIntent::SetKerningGroupMember {
            position: KerningPosition::Second,
            glyph_id: b,
            group_id: Some(a_group),
        },
    );
    // Then T against A alone becomes an exception at one master.
    edit(
        &mut font,
        FontIntent::SetKerningValues {
            edits: vec![KerningValueEdit {
                source_id: bold_wide,
                pair: KerningPair::new(KerningSide::Glyph(t), KerningSide::Glyph(a)),
                value: Some(-300.0),
            }],
        },
    );
    let bytes = compile(&font);

    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), -300);
    assert_eq!(kern_at(&bytes, "TA", LIGHT_CONDENSED), -75);
    assert_eq!(kern_at(&bytes, "TB", BOLD_WIDE), -150);
    assert_eq!(kern_at(&bytes, "TB", LIGHT_CONDENSED), -75);
}

#[test]
fn renaming_a_group_keeps_every_masters_kern() {
    let mut font = mutatorsans();
    let a = font.glyph_id_by_name("A").unwrap();
    let a_group = font
        .kerning()
        .group_of(KerningPosition::Second, &a)
        .expect("A kerns through a group")
        .clone();

    edit(
        &mut font,
        FontIntent::RenameKerningGroup {
            group_id: a_group,
            name: "Apex".to_string(),
        },
    );
    let bytes = compile(&font);

    assert_eq!(kern_at(&bytes, "TA", LIGHT_CONDENSED), -75);
    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), -150);
}

#[test]
fn taking_a_glyph_out_of_its_group_stops_its_group_kerning() {
    let mut font = mutatorsans();
    let a = font.glyph_id_by_name("A").unwrap();

    edit(
        &mut font,
        FontIntent::SetKerningGroupMember {
            position: KerningPosition::Second,
            glyph_id: a,
            group_id: None,
        },
    );
    let bytes = compile(&font);

    assert_eq!(kern_at(&bytes, "TA", LIGHT_CONDENSED), 0);
    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), 0);
}

/// Removes the pair that applies between T and A at one master.
fn remove_t_a_at(font: &mut Font, filename: &str) {
    let t = font.glyph_id_by_name("T").unwrap();
    let a = font.glyph_id_by_name("A").unwrap();
    let source_id = master(font, filename);
    let pair = font.kerning().resolve(&source_id, &t, &a).unwrap().pair;
    edit(
        font,
        FontIntent::SetKerningValues {
            edits: vec![KerningValueEdit {
                source_id,
                pair,
                value: None,
            }],
        },
    );
}

#[test]
fn a_pair_removed_at_a_master_that_still_kerns_others_kerns_zero_there() {
    let mut font = mutatorsans();
    remove_t_a_at(&mut font, "MutatorSansLightCondensed.ufo");
    let bytes = compile(&font);

    assert_eq!(kern_at(&bytes, "TA", LIGHT_CONDENSED), 0);
    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), -150);
}

#[test]
fn a_master_left_without_kerning_is_interpolated_from_the_others() {
    let mut font = mutatorsans();
    // T/A is BoldWide's only pair.
    remove_t_a_at(&mut font, "MutatorSansBoldWide.ufo");
    let bytes = compile(&font);

    assert_eq!(kern_at(&bytes, "TA", BOLD_WIDE), -205);
}

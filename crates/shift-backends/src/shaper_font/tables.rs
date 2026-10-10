//! Adjusts fea-rs output into the tables a shaper font carries.

use std::collections::BTreeMap;

use fea_rs::compile::Compilation;
use fea_rs::parse::ParseTree;
use fea_rs::typed::{AstNode, Feature};
use fea_rs::GlyphMap;
use fontdrasil::types::Axis as IrAxis;
use write_fonts::tables::fvar::{AxisInstanceArrays, Fvar, VariationAxisRecord};
use write_fonts::tables::gdef::GlyphClassDef;
use write_fonts::tables::layout::ClassDef;
use write_fonts::tables::name::NameRecord;
use write_fonts::types::{NameId, Tag};

use super::{InsertMarker, ShaperFontError};

/// Features export generates from structured kerning and anchors, in the
/// order a feature writer would insert them.
const GENERATED_FEATURES: [Tag; 4] = [
    Tag::new(b"curs"),
    Tag::new(b"kern"),
    Tag::new(b"mark"),
    Tag::new(b"mkmk"),
];

/// Windows platform, Unicode BMP encoding, US English: the one `name` record
/// form shapers and every OpenType consumer read.
const WINDOWS_PLATFORM_ID: u16 = 3;
const WINDOWS_UNICODE_BMP_ENCODING_ID: u16 = 1;
const WINDOWS_ENGLISH_US_LANGUAGE_ID: u16 = 0x0409;

/// Classifies glyphs by category unless the feature source declared its own
/// glyph classes, which are more specific, as in export.
pub(super) fn add_glyph_classes(
    compilation: &mut Compilation,
    glyph_map: &GlyphMap,
    classes: &BTreeMap<String, GlyphClassDef>,
) {
    if compilation.gdef_classes.is_some() {
        return;
    }

    let class_def: ClassDef = classes
        .iter()
        .filter_map(|(name, class)| Some((glyph_map.get(name.as_str())?, *class as u16)))
        .collect();
    if class_def.iter().next().is_none() {
        return;
    }

    compilation
        .gdef
        .get_or_insert_with(Default::default)
        .glyph_class_def
        .set(class_def);
}

/// Names each axis in the compiled `name` table and returns the matching
/// `fvar`, so a shaper can resolve variations by axis tag.
///
/// # Errors
///
/// Returns [`ShaperFontError::NameIdOverflow`] when the axis names do not fit
/// after the feature source's own name ids.
pub(super) fn add_axis_names(
    compilation: &mut Compilation,
    axes: &[IrAxis],
) -> Result<Fvar, ShaperFontError> {
    let name = compilation.name.get_or_insert_with(Default::default);
    let mut name_id = name
        .name_record
        .iter()
        .map(|record| record.name_id)
        .fold(NameId::LAST_RESERVED_NAME_ID, NameId::max);

    let mut records = Vec::with_capacity(axes.len());
    for axis in axes {
        name_id = name_id
            .checked_add(1)
            .ok_or(ShaperFontError::NameIdOverflow)?;
        name.name_record.push(NameRecord::new(
            WINDOWS_PLATFORM_ID,
            WINDOWS_UNICODE_BMP_ENCODING_ID,
            WINDOWS_ENGLISH_US_LANGUAGE_ID,
            name_id,
            axis.ui_label_name().to_string().into(),
        ));
        records.push(VariationAxisRecord {
            axis_tag: axis.tag,
            min_value: axis.min.into(),
            default_value: axis.default.into(),
            max_value: axis.max.into(),
            axis_name_id: name_id,
            ..Default::default()
        });
    }
    name.name_record.sort();

    Ok(Fvar::new(AxisInstanceArrays::new(records, Vec::new())))
}

/// Where each generated feature belongs among the authored lookups: at its
/// `# Automatic Code` marker, ordered by insertion priority, or after every
/// authored lookup when the source neither marks nor defines the feature.
pub(super) fn insert_markers(compilation: &Compilation, tree: &ParseTree) -> Vec<InsertMarker> {
    let mut marked: Vec<_> = compilation.insert_markers.iter().collect();
    marked.sort_by_key(|(_, point)| point.priority);
    let mut markers: Vec<InsertMarker> = marked
        .into_iter()
        .map(|(tag, point)| InsertMarker {
            tag: *tag,
            lookup_index: Some(point.lookup_id.to_raw()),
        })
        .collect();

    let authored = authored_features(tree);
    for tag in GENERATED_FEATURES {
        let marked = markers.iter().any(|marker| marker.tag == tag);
        if !marked && !authored.contains(&tag) {
            markers.push(InsertMarker {
                tag,
                lookup_index: None,
            });
        }
    }
    markers
}

fn authored_features(tree: &ParseTree) -> Vec<Tag> {
    tree.typed_root()
        .statements()
        .filter_map(Feature::cast)
        .filter_map(|feature| feature.tag().text().parse().ok())
        .collect()
}

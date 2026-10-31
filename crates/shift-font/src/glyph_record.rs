//! What the editor reads about each glyph without loading its layers: its
//! identity, its master layers, the glyphs its components use, and how
//! anchor propagation and export treat it by category
//! ([`crate::ir::glyph_category`]).

use serde::{Deserialize, Serialize};

use crate::ir::glyph_category::{GlyphDataCategory, Ligature, OpenTypeCategories, RecordCategory};
use crate::{Font, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId, SourceId};

/// One glyph as the editor's directory lists it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct GlyphRecord {
    pub id: GlyphId,
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
    /// The glyphs the components of any of its layers use, directly, in id order.
    pub component_base_glyph_ids: Vec<GlyphId>,
    /// Its layers on the font's masters, in master order.
    pub layers: Vec<GlyphLayerRecord>,
    /// In the Mark category or classed `mark`: anchor propagation keeps its own anchors.
    pub mark: bool,
    /// A nonspacing mark (Mark category, Nonspacing subcategory): export
    /// compiles it with no advance.
    pub nonspacing_mark: bool,
    /// Whether anchor propagation treats the glyph as a ligature; `None`
    /// when it does not.
    pub ligature: Option<Ligature>,
}

/// A glyph layer by id, and the source it belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct GlyphLayerRecord {
    pub id: LayerId,
    pub source_id: SourceId,
}

impl From<&GlyphLayer> for GlyphLayerRecord {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            id: layer.id(),
            source_id: layer.source_id(),
        }
    }
}

/// The glyph records one edit changed: the changed glyphs' records as they
/// are now, and the glyphs it removed. Every other record is unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct GlyphRecordChanges {
    pub updated: Vec<GlyphRecord>,
    pub removed: Vec<GlyphId>,
}

impl Font {
    /// `glyph`'s record, with `component_base_glyph_ids` as given and its
    /// category from `glyph_data` and the font lib's classes (`explicit`,
    /// [`OpenTypeCategories::of`] the font).
    pub fn glyph_record(
        &self,
        glyph: &Glyph,
        component_base_glyph_ids: Vec<GlyphId>,
        glyph_data: GlyphDataCategory,
        explicit: &OpenTypeCategories<'_>,
    ) -> GlyphRecord {
        let category = RecordCategory::of(glyph, glyph_data, explicit.class(glyph.name()));
        GlyphRecord {
            id: glyph.id(),
            name: glyph.glyph_name().clone(),
            unicodes: glyph.unicodes().to_vec(),
            component_base_glyph_ids,
            layers: self
                .master_layers(glyph)
                .map(|layer| GlyphLayerRecord::from(layer.as_ref()))
                .collect(),
            mark: category.mark,
            nonspacing_mark: category.nonspacing_mark,
            ligature: category.ligature,
        }
    }
}

impl GlyphRecord {
    /// Sorts `records` by glyph name, the order the editor lists them in.
    pub fn sort_by_name(records: &mut [Self]) {
        records.sort_by(|a, b| a.name.cmp(&b.name));
    }
}

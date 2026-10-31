//! What the editor reads about each glyph without loading its layers: its
//! identity, its master layers, the glyphs its components use, and how
//! anchor propagation and export treat it by category
//! ([`crate::ir::glyph_category`]).

use serde::{Deserialize, Serialize};

use crate::ir::glyph_category::{GlyphDataCategory, Ligature, OpenTypeCategories, RecordCategory};
use crate::{Font, FontChangeSet, Glyph, GlyphId, GlyphLayer, GlyphName, LayerId, SourceId};

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

/// Glyph records in name order, one per name: the order the editor lists
/// glyphs in. Collecting records orders them, whatever order they come in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(transparent)]
pub struct GlyphRecords(Vec<GlyphRecord>);

/// Read as a slice, in name order; only collecting changes the records.
impl std::ops::Deref for GlyphRecords {
    type Target = [GlyphRecord];

    fn deref(&self) -> &[GlyphRecord] {
        &self.0
    }
}

impl FromIterator<GlyphRecord> for GlyphRecords {
    fn from_iter<I: IntoIterator<Item = GlyphRecord>>(records: I) -> Self {
        let mut collected = Self::default();
        collected.extend(records);
        collected
    }
}

/// A record whose name is already held replaces that record.
impl Extend<GlyphRecord> for GlyphRecords {
    fn extend<I: IntoIterator<Item = GlyphRecord>>(&mut self, records: I) {
        self.0.extend(records);
        // Stable and adaptive: runs already in name order merge in linear time.
        self.0.sort_by(|a, b| a.name.cmp(&b.name));
        self.0.dedup_by(|later, kept| {
            if later.name != kept.name {
                return false;
            }
            std::mem::swap(later, kept);
            true
        });
    }
}

impl IntoIterator for GlyphRecords {
    type Item = GlyphRecord;
    type IntoIter = std::vec::IntoIter<GlyphRecord>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a> IntoIterator for &'a GlyphRecords {
    type Item = &'a GlyphRecord;
    type IntoIter = std::slice::Iter<'a, GlyphRecord>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

/// The glyph records one edit changed: the changed glyphs' records as they
/// are now, the glyphs it removed, and, for a reply that asks for it, the
/// font's new glyph order when the edit moved any glyph in it. Every other
/// record is unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub struct GlyphRecordChanges {
    pub updated: GlyphRecords,
    pub removed: Vec<GlyphId>,
    /// Every glyph's id in name order ([`Font::glyph_ids_by_name`]) when the
    /// edit added, removed or renamed a glyph and the reply carries the
    /// order ([`Self::with_order`]); `None` otherwise.
    pub order: Option<Vec<GlyphId>>,
}

impl GlyphRecordChanges {
    /// What `changes` did to `font`'s glyph records, `font` being the font
    /// they left: `records_of` builds the records of the changed glyphs it
    /// still has, and the glyphs it lacks are removed. Carries no order.
    ///
    /// # Errors
    ///
    /// Returns `records_of`'s error.
    pub fn of<E>(
        font: &Font,
        changes: &FontChangeSet,
        records_of: impl FnOnce(&[&Glyph]) -> Result<GlyphRecords, E>,
    ) -> Result<Self, E> {
        let mut changed = Vec::new();
        let mut removed = Vec::new();
        for glyph_id in changes.record_glyph_ids() {
            match font.glyph(glyph_id) {
                Some(glyph) => changed.push(glyph),
                None => removed.push(glyph_id),
            }
        }
        Ok(Self {
            updated: records_of(&changed)?,
            removed,
            order: None,
        })
    }

    /// These changes with `font`'s glyph order when `changes` moved a glyph
    /// in it, for a reader that keeps the records in that order. On a
    /// 50,000-glyph font the order is 50,000 ids, so only a reply whose
    /// reader lists the records carries it.
    pub fn with_order(self, font: &Font, changes: &FontChangeSet) -> Self {
        Self {
            order: changes
                .reorders_glyphs()
                .then(|| font.glyph_ids_by_name().collect()),
            ..self
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn record(name: &str) -> GlyphRecord {
        GlyphRecord {
            id: GlyphId::from_raw(name),
            name: GlyphName::from(name),
            unicodes: Vec::new(),
            component_base_glyph_ids: Vec::new(),
            layers: Vec::new(),
            mark: false,
            nonspacing_mark: false,
            ligature: None,
        }
    }

    fn names(records: &GlyphRecords) -> Vec<&str> {
        records.iter().map(|record| record.name.as_str()).collect()
    }

    #[test]
    fn collected_records_are_in_name_order() {
        let records: GlyphRecords = ["b", "a", "B", "a.alt"].map(record).into_iter().collect();

        assert_eq!(names(&records), ["B", "a", "a.alt", "b"]);
    }

    #[test]
    fn extending_replaces_a_record_of_the_same_name() {
        let mut records: GlyphRecords = ["a", "c"].map(record).into_iter().collect();
        let mut marked = record("a");
        marked.mark = true;

        records.extend([record("b"), marked]);

        assert_eq!(names(&records), ["a", "b", "c"]);
        assert!(records[0].mark);
    }
}

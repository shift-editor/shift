//! Lists the features a shaper font's feature code defines.

use std::collections::BTreeMap;

use skrifa::MetadataProvider;
use skrifa::raw::tables::layout::{FeatureList, FeatureParams};
use skrifa::raw::{FontRef, TableProvider};
use skrifa::string::StringId;

use super::{ShapeError, ShaperFont};

/// A feature the font's feature code defines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FontFeature {
    /// The feature tag, such as `liga` or `ss01`.
    pub tag: String,
    /// The name a `featureNames` block gives a stylistic set or character
    /// variant; `None` for other features and unnamed ones.
    pub name: Option<String>,
}

impl ShaperFont {
    /// Returns the features in the compiled `GSUB` and `GPOS`, once per tag, in
    /// tag order.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the shaper font cannot be read.
    pub fn features(&self) -> Result<Vec<FontFeature>, ShapeError> {
        let font = FontRef::new(self.bytes()).map_err(|_| ShapeError::InvalidFont)?;
        let mut features: BTreeMap<String, Option<String>> = BTreeMap::new();
        let lists = [
            font.gsub().ok().and_then(|gsub| gsub.feature_list().ok()),
            font.gpos().ok().and_then(|gpos| gpos.feature_list().ok()),
        ];
        for list in lists.into_iter().flatten() {
            for (tag, name) in named_features(&font, &list) {
                let entry = features.entry(tag).or_default();
                if entry.is_none() {
                    *entry = name;
                }
            }
        }
        Ok(features
            .into_iter()
            .map(|(tag, name)| FontFeature { tag, name })
            .collect())
    }
}

/// Each feature record's tag, with its UI name when its parameters give one.
fn named_features<'a>(
    font: &'a FontRef<'a>,
    list: &'a FeatureList<'a>,
) -> impl Iterator<Item = (String, Option<String>)> + 'a {
    list.feature_records().iter().map(move |record| {
        let name_id = record
            .feature(list.offset_data())
            .ok()
            .and_then(|feature| feature.feature_params()?.ok())
            .and_then(|params| match params {
                FeatureParams::StylisticSet(set) => Some(set.ui_name_id()),
                FeatureParams::CharacterVariant(variant) => Some(variant.feat_ui_label_name_id()),
                FeatureParams::Size(_) => None,
            });
        let name = name_id.and_then(|id| {
            font.localized_strings(StringId::new(id.to_u16()))
                .english_or_first()
                .map(|name| name.to_string())
        });
        (record.feature_tag().to_string(), name)
    })
}

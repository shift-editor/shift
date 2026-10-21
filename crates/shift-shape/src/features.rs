//! Lists the features a shaping font defines, and how the shaper treats each.

use std::collections::BTreeMap;

use read_fonts::tables::layout::{FeatureList, FeatureParams};
use read_fonts::types::{NameId, Tag};
use read_fonts::{FontRef, TableProvider};

use crate::{ShapeError, Shaper};

/// Windows platform, US English: the `name` record a feature's UI name is
/// read from first.
const WINDOWS_PLATFORM_ID: u16 = 3;
const WINDOWS_ENGLISH_US_LANGUAGE_ID: u16 = 0x0409;

/// Features the shaper applies for a script's shaping, or that export
/// generates from structured data; text never switches them.
const REQUIRED: [&[u8; 4]; 40] = [
    b"aalt", b"abvf", b"abvm", b"abvs", b"akhn", b"blwf", b"blwm", b"blws", b"ccmp", b"cfar",
    b"cjct", b"curs", b"dist", b"fin2", b"fin3", b"fina", b"half", b"haln", b"init", b"isol",
    b"kern", b"ljmo", b"locl", b"mark", b"med2", b"medi", b"mkmk", b"nukt", b"pref", b"pres",
    b"pstf", b"psts", b"rclt", b"rkrf", b"rlig", b"rphf", b"rvrn", b"stch", b"tjmo", b"vjmo",
];

/// Features the shaper applies unless text turns them off.
const ON_BY_DEFAULT: [&[u8; 4]; 3] = [b"calt", b"clig", b"liga"];

/// What a feature does when text does not set it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureDefault {
    /// The shaper always applies it: a script's shaping needs it, or export
    /// generates it. Text never switches it.
    Required,
    /// The shaper applies it unless text turns it off, such as `liga`.
    On,
    /// The shaper applies it only when text turns it on, such as `ss01`.
    Off,
}

impl FeatureDefault {
    /// Returns how the shaper treats a feature by its tag.
    pub fn of(tag: Tag) -> Self {
        let bytes = tag.to_be_bytes();
        if REQUIRED.iter().any(|required| **required == bytes) {
            Self::Required
        } else if ON_BY_DEFAULT.iter().any(|on| **on == bytes) {
            Self::On
        } else {
            Self::Off
        }
    }
}

/// A feature the shaping font defines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FontFeature {
    pub tag: Tag,
    /// The name a `featureNames` block gives a stylistic set or character
    /// variant; `None` for other features and unnamed ones.
    pub name: Option<String>,
    pub default: FeatureDefault,
}

impl Shaper {
    /// Returns the features in the font's `GSUB` and `GPOS`, once per tag, in
    /// tag order, each with how the shaper treats it by default.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the font cannot be read.
    pub fn features(&self) -> Result<Vec<FontFeature>, ShapeError> {
        let font = self.font()?;
        let lists = [
            font.gsub().ok().and_then(|gsub| gsub.feature_list().ok()),
            font.gpos().ok().and_then(|gpos| gpos.feature_list().ok()),
        ];
        let mut features: BTreeMap<Tag, Option<String>> = BTreeMap::new();
        for list in lists.iter().flatten() {
            for (tag, name) in named_features(&font, list) {
                let entry = features.entry(tag).or_default();
                if entry.is_none() {
                    *entry = name;
                }
            }
        }
        Ok(features
            .into_iter()
            .map(|(tag, name)| FontFeature {
                tag,
                name,
                default: FeatureDefault::of(tag),
            })
            .collect())
    }
}

/// Each feature record's tag, with its UI name when its parameters give one.
fn named_features<'a>(
    font: &'a FontRef<'a>,
    list: &'a FeatureList<'a>,
) -> impl Iterator<Item = (Tag, Option<String>)> + 'a {
    list.feature_records().iter().map(move |record| {
        let name = record
            .feature(list.offset_data())
            .ok()
            .and_then(|feature| feature.feature_params()?.ok())
            .and_then(|params| match params {
                FeatureParams::StylisticSet(set) => Some(set.ui_name_id()),
                FeatureParams::CharacterVariant(variant) => Some(variant.feat_ui_label_name_id()),
                FeatureParams::Size(_) => None,
            })
            .and_then(|name_id| name_string(font, name_id));
        (record.feature_tag(), name)
    })
}

/// Returns a `name` string, in US English where the font has it, otherwise
/// the first record with that id.
fn name_string(font: &FontRef<'_>, name_id: NameId) -> Option<String> {
    let name = font.name().ok()?;
    let records: Vec<_> = name
        .name_record()
        .iter()
        .filter(|record| record.name_id() == name_id)
        .collect();
    let english = records.iter().find(|record| {
        record.platform_id() == WINDOWS_PLATFORM_ID
            && record.language_id() == WINDOWS_ENGLISH_US_LANGUAGE_ID
    });
    let record = english.or_else(|| records.first())?;
    let string = record.string(name.string_data()).ok()?;
    Some(string.chars().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_features_are_required_and_ligatures_are_on() {
        let default = |tag: &[u8; 4]| FeatureDefault::of(Tag::new(tag));

        assert_eq!(default(b"init"), FeatureDefault::Required);
        assert_eq!(default(b"kern"), FeatureDefault::Required);
        assert_eq!(default(b"liga"), FeatureDefault::On);
        assert_eq!(default(b"ss01"), FeatureDefault::Off);
        assert_eq!(default(b"dlig"), FeatureDefault::Off);
    }
}

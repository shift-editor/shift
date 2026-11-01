//! Lists the features a shaping font defines, and how the shaper treats each.

use std::collections::BTreeMap;

use read_fonts::tables::layout::{FeatureList, FeatureParams};
use read_fonts::types::{NameId, Tag};
use read_fonts::{FontRef, TableProvider};

use crate::shape::{ShapeError, Shaper};

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

/// Registered names for common features, from the OpenType feature tag
/// registry, for a feature whose font gives it no name.
const REGISTERED_NAMES: [(&[u8; 4], &str); 60] = [
    (b"aalt", "Access All Alternates"),
    (b"abvm", "Above-base Mark Positioning"),
    (b"abvs", "Above-base Substitutions"),
    (b"afrc", "Alternative Fractions"),
    (b"akhn", "Akhand"),
    (b"blwf", "Below-base Forms"),
    (b"blwm", "Below-base Mark Positioning"),
    (b"blws", "Below-base Substitutions"),
    (b"c2sc", "Small Capitals From Capitals"),
    (b"calt", "Contextual Alternates"),
    (b"case", "Case-Sensitive Forms"),
    (b"ccmp", "Glyph Composition"),
    (b"cjct", "Conjunct Forms"),
    (b"clig", "Contextual Ligatures"),
    (b"cpsp", "Capital Spacing"),
    (b"curs", "Cursive Positioning"),
    (b"dist", "Distances"),
    (b"dlig", "Discretionary Ligatures"),
    (b"dnom", "Denominators"),
    (b"fina", "Terminal Forms"),
    (b"frac", "Fractions"),
    (b"half", "Half Forms"),
    (b"hist", "Historical Forms"),
    (b"init", "Initial Forms"),
    (b"isol", "Isolated Forms"),
    (b"kern", "Kerning"),
    (b"liga", "Standard Ligatures"),
    (b"ljmo", "Leading Jamo Forms"),
    (b"lnum", "Lining Figures"),
    (b"locl", "Localized Forms"),
    (b"mark", "Mark Positioning"),
    (b"medi", "Medial Forms"),
    (b"mkmk", "Mark to Mark Positioning"),
    (b"nukt", "Nukta Forms"),
    (b"numr", "Numerators"),
    (b"onum", "Oldstyle Figures"),
    (b"ordn", "Ordinals"),
    (b"pnum", "Proportional Figures"),
    (b"pref", "Pre-base Forms"),
    (b"pres", "Pre-base Substitutions"),
    (b"pstf", "Post-base Forms"),
    (b"psts", "Post-base Substitutions"),
    (b"rclt", "Required Contextual Alternates"),
    (b"rlig", "Required Ligatures"),
    (b"rphf", "Reph Form"),
    (b"salt", "Stylistic Alternates"),
    (b"sinf", "Scientific Inferiors"),
    (b"smcp", "Small Capitals"),
    (b"subs", "Subscript"),
    (b"sups", "Superscript"),
    (b"swsh", "Swash"),
    (b"titl", "Titling"),
    (b"tjmo", "Trailing Jamo Forms"),
    (b"tnum", "Tabular Figures"),
    (b"vatu", "Vattu Variants"),
    (b"vjmo", "Vowel Jamo Forms"),
    (b"zero", "Slashed Zero"),
    (b"cswh", "Contextual Swash"),
    (b"pcap", "Petite Capitals"),
    (b"unic", "Unicase"),
];

/// The kind of thing a feature changes, which a feature list groups by.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum FeatureGroup {
    Ligatures,
    LetterCase,
    Figures,
    FractionsAndPositions,
    StylisticSets,
    CharacterVariants,
    Alternates,
    #[default]
    Other,
}

impl FeatureGroup {
    /// Returns the group a feature belongs to by its tag.
    pub fn of(tag: Tag) -> Self {
        match &tag.to_be_bytes() {
            b"liga" | b"dlig" | b"hlig" | b"clig" => Self::Ligatures,
            b"smcp" | b"c2sc" | b"pcap" | b"c2pc" | b"unic" | b"titl" | b"case" | b"cpsp" => {
                Self::LetterCase
            }
            b"onum" | b"lnum" | b"tnum" | b"pnum" | b"zero" => Self::Figures,
            b"frac" | b"afrc" | b"numr" | b"dnom" | b"sups" | b"subs" | b"sinf" | b"ordn" => {
                Self::FractionsAndPositions
            }
            b"calt" | b"salt" | b"swsh" | b"cswh" | b"hist" | b"nalt" | b"ornm" => Self::Alternates,
            _ if numbered(tag, *b"ss").is_some() => Self::StylisticSets,
            _ if numbered(tag, *b"cv").is_some() => Self::CharacterVariants,
            _ => Self::Other,
        }
    }
}

/// The number of a numbered feature such as `ss01` or `cv12`, for `prefix`
/// `ss` or `cv`; `None` for any other tag, and for `ss00`.
fn numbered(tag: Tag, prefix: [u8; 2]) -> Option<u8> {
    let [a, b, tens, ones] = tag.to_be_bytes();
    if [a, b] != prefix || !tens.is_ascii_digit() || !ones.is_ascii_digit() {
        return None;
    }
    let number = (tens - b'0') * 10 + (ones - b'0');
    (number > 0).then_some(number)
}

/// The name a feature is shown by when its font names none: the registered
/// name, or a numbered set's, such as "Stylistic Set 1".
fn default_name(tag: Tag) -> Option<String> {
    let bytes = tag.to_be_bytes();
    if let Some((_, name)) = REGISTERED_NAMES
        .iter()
        .find(|(registered, _)| **registered == bytes)
    {
        return Some((*name).to_string());
    }
    if let Some(number) = numbered(tag, *b"ss") {
        return Some(format!("Stylistic Set {number}"));
    }
    numbered(tag, *b"cv").map(|number| format!("Character Variant {number}"))
}

/// What a feature does when text does not set it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum FeatureDefault {
    /// The shaper always applies it: a script's shaping needs it, or export
    /// generates it. Text never switches it.
    Required,
    /// The shaper applies it unless text turns it off, such as `liga`.
    On,
    /// The shaper applies it only when text turns it on, such as `ss01`.
    #[default]
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

    /// Whether the shaper applies a feature treated so when text sets it to
    /// `setting` (`None` when text leaves it): text's setting wins, a value
    /// above 0 applying it and 0 not; left unset, a `Required` or `On`
    /// feature applies and an `Off` one does not. The Features section
    /// offers no switch for a `Required` one.
    pub fn applies(self, setting: Option<u32>) -> bool {
        match (self, setting) {
            (_, Some(value)) => value > 0,
            (Self::Required | Self::On, None) => true,
            (Self::Off, None) => false,
        }
    }
}

/// A feature the shaping font defines.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct FontFeature {
    /// The feature tag, such as `liga` or `ss01`.
    pub tag: String,
    /// The name it is shown by: the one a `featureNames` block gives a
    /// stylistic set or character variant, otherwise the registered name or a
    /// numbered set's; `None` for a tag with none.
    pub name: Option<String>,
    pub default: FeatureDefault,
    pub group: FeatureGroup,
}

impl Shaper {
    /// Returns the features in the font's `GSUB` and `GPOS`, once per tag, in
    /// tag order, each with its name, how the shaper treats it by default, and
    /// its group.
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
        let mut names: BTreeMap<Tag, Option<String>> = BTreeMap::new();
        for list in lists.iter().flatten() {
            for (tag, name) in named_features(&font, list) {
                let entry = names.entry(tag).or_default();
                if entry.is_none() {
                    *entry = name;
                }
            }
        }
        Ok(names
            .into_iter()
            .map(|(tag, name)| FontFeature {
                tag: tag.to_string(),
                name: name.or_else(|| default_name(tag)),
                default: FeatureDefault::of(tag),
                group: FeatureGroup::of(tag),
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
    let mut records = name
        .name_record()
        .iter()
        .filter(|record| record.name_id() == name_id);
    let first = records.next()?;
    let english = std::iter::once(first).chain(records).find(|record| {
        record.platform_id() == WINDOWS_PLATFORM_ID
            && record.language_id() == WINDOWS_ENGLISH_US_LANGUAGE_ID
    });
    let record = english.unwrap_or(first);
    let string = record.string(name.string_data()).ok()?;
    Some(string.chars().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_feature_applies_as_text_sets_it_else_by_its_default() {
        let applies = |default: FeatureDefault| {
            [None, Some(0), Some(1)].map(|setting| default.applies(setting))
        };

        assert_eq!(applies(FeatureDefault::Required), [true, false, true]);
        assert_eq!(applies(FeatureDefault::On), [true, false, true]);
        assert_eq!(applies(FeatureDefault::Off), [false, false, true]);
    }

    #[test]
    fn script_features_are_required_and_ligatures_are_on() {
        let default = |tag: &[u8; 4]| FeatureDefault::of(Tag::new(tag));

        assert_eq!(default(b"init"), FeatureDefault::Required);
        assert_eq!(default(b"kern"), FeatureDefault::Required);
        assert_eq!(default(b"liga"), FeatureDefault::On);
        assert_eq!(default(b"ss01"), FeatureDefault::Off);
        assert_eq!(default(b"dlig"), FeatureDefault::Off);
    }

    #[test]
    fn features_group_by_what_they_change() {
        let group = |tag: &[u8; 4]| FeatureGroup::of(Tag::new(tag));

        assert_eq!(group(b"dlig"), FeatureGroup::Ligatures);
        assert_eq!(group(b"smcp"), FeatureGroup::LetterCase);
        assert_eq!(group(b"tnum"), FeatureGroup::Figures);
        assert_eq!(group(b"frac"), FeatureGroup::FractionsAndPositions);
        assert_eq!(group(b"ss03"), FeatureGroup::StylisticSets);
        assert_eq!(group(b"cv12"), FeatureGroup::CharacterVariants);
        assert_eq!(group(b"salt"), FeatureGroup::Alternates);
        assert_eq!(group(b"ss00"), FeatureGroup::Other);
        assert_eq!(group(b"kern"), FeatureGroup::Other);
    }

    #[test]
    fn unnamed_features_take_the_registered_or_numbered_name() {
        let name = |tag: &[u8; 4]| default_name(Tag::new(tag));

        assert_eq!(name(b"liga").as_deref(), Some("Standard Ligatures"));
        assert_eq!(name(b"ss01").as_deref(), Some("Stylistic Set 1"));
        assert_eq!(name(b"cv12").as_deref(), Some("Character Variant 12"));
        assert_eq!(name(b"xxxx"), None);
    }
}

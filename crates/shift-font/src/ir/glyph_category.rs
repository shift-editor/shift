//! Glyph categories in the Glyphs app taxonomy.
//!
//! A glyph stores a category only when its designer or source set one
//! explicitly; otherwise its category comes from glyph data by name and
//! codepoint. The compiler maps categories to OpenType GDEF classes, so a
//! nonspacing mark is a mark and a letter carrying an `_` anchor is not.
//! Names match the strings `.glyphs` files and `GlyphData.xml` use.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

macro_rules! named_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $($variant:ident => $text:literal),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$(Self::$variant),+];

            /// The name `.glyphs` files and glyph data use.
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl FromStr for $name {
            type Err = UnknownGlyphCategory;

            fn from_str(text: &str) -> Result<Self, Self::Err> {
                match text {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(UnknownGlyphCategory(text.to_string())),
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let text = String::deserialize(deserializer)?;
                text.parse().map_err(serde::de::Error::custom)
            }
        }
    };
}

named_enum! {
    /// A glyph's primary category.
    GlyphCategory {
        Letter => "Letter",
        Mark => "Mark",
        Number => "Number",
        Punctuation => "Punctuation",
        Symbol => "Symbol",
        Separator => "Separator",
        Space => "Space",
        Other => "Other",
    }
}

named_enum! {
    /// A refinement of a glyph's category, such as `Nonspacing` for marks.
    GlyphSubcategory {
        Arrow => "Arrow",
        Compatibility => "Compatibility",
        Composition => "Composition",
        Conjunct => "Conjunct",
        Currency => "Currency",
        Dash => "Dash",
        DecimalDigit => "Decimal Digit",
        Emoji => "Emoji",
        Enclosing => "Enclosing",
        Format => "Format",
        Fraction => "Fraction",
        Geometry => "Geometry",
        Halfform => "Halfform",
        Jamo => "Jamo",
        Letter => "Letter",
        Ligature => "Ligature",
        Lowercase => "Lowercase",
        Math => "Math",
        Matra => "Matra",
        Modifier => "Modifier",
        Nonspacing => "Nonspacing",
        Number => "Number",
        Other => "Other",
        Parenthesis => "Parenthesis",
        Quote => "Quote",
        Radical => "Radical",
        Small => "Small",
        Smallcaps => "Smallcaps",
        Space => "Space",
        Spacing => "Spacing",
        SpacingCombining => "Spacing Combining",
        Superscript => "Superscript",
        Syllable => "Syllable",
        Uppercase => "Uppercase",
    }
}

/// A category or subcategory name Shift does not know.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("unknown glyph category {0:?}")]
pub struct UnknownGlyphCategory(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for category in GlyphCategory::ALL {
            assert_eq!(category.as_str().parse::<GlyphCategory>(), Ok(*category));
        }
        for subcategory in GlyphSubcategory::ALL {
            assert_eq!(
                subcategory.as_str().parse::<GlyphSubcategory>(),
                Ok(*subcategory)
            );
        }
        assert_eq!(
            "Spacing Combining".parse(),
            Ok(GlyphSubcategory::SpacingCombining)
        );
        assert!("Vowel".parse::<GlyphCategory>().is_err());
    }
}

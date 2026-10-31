//! Glyph categories in the Glyphs app taxonomy.
//!
//! A glyph stores a category only when its designer or source set one
//! explicitly; otherwise its category comes from glyph data by name and
//! codepoint. The compiler maps categories to OpenType GDEF classes, so a
//! nonspacing mark is a mark and a letter carrying an `_` anchor is not.
//! Names match the strings `.glyphs` files and `GlyphData.xml` use.
//!
//! The rule that classes a glyph is here too, so every consumer applies the
//! same one: a glyph's own category and subcategory, each falling back to
//! glyph data's ([`GlyphDataCategory::resolve`]), then the GDEF class a UFO's
//! `public.openTypeCategories` gives it by name ([`OpenTypeCategories`]),
//! which wins for marks and ligatures ([`RecordCategory::of`]). Glyph data
//! itself is large and lives with the store's reader, not here: callers look
//! a glyph up by name and codepoints ([`NamedGlyph`]) and pass the answer in.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{Glyph, GlyphId, GlyphName, LibData, LibValue};

macro_rules! named_enum {
    (
        $(#[$meta:meta])*
        $name:ident { $($variant:ident => $text:literal),+ $(,)? }
    ) => {
        crate::string_enum! {
            $(#[$meta])*
            #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
            pub enum $name {
                $($variant => $text,)+
            }
            parse_error: UnknownGlyphCategory = |text| UnknownGlyphCategory(text.to_string());
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
    #[cfg_attr(feature = "pack", derive(pack::Pack))]
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
    #[cfg_attr(feature = "pack", derive(pack::Pack))]
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

/// Font lib key a UFO uses for explicit GDEF classes.
pub const OPENTYPE_CATEGORIES_KEY: &str = "public.openTypeCategories";

/// What glyph data is asked about a glyph: its name and codepoints.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct NamedGlyph {
    pub name: GlyphName,
    pub unicodes: Vec<u32>,
}

impl From<&Glyph> for NamedGlyph {
    fn from(glyph: &Glyph) -> Self {
        Self {
            name: glyph.glyph_name().clone(),
            unicodes: glyph.unicodes().to_vec(),
        }
    }
}

/// A category and subcategory: glyph data's for a name and codepoints, or a
/// glyph's effective one once [resolved](Self::resolve) against its own.
/// Either is `None` where nothing says.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub struct GlyphDataCategory {
    pub category: Option<GlyphCategory>,
    pub sub_category: Option<GlyphSubcategory>,
}

impl GlyphDataCategory {
    /// The glyph's effective category: its own category and subcategory,
    /// each falling back to this.
    pub fn resolve(self, glyph: &Glyph) -> Self {
        Self {
            category: glyph.category().or(self.category),
            sub_category: glyph.sub_category().or(self.sub_category),
        }
    }

    /// Whether this is the Mark category, whatever its subcategory.
    pub fn is_mark(self) -> bool {
        self.category == Some(GlyphCategory::Mark)
    }

    /// Whether this is a combining mark that takes no horizontal space.
    pub fn is_nonspacing_mark(self) -> bool {
        self.is_mark() && self.sub_category == Some(GlyphSubcategory::Nonspacing)
    }
}

/// An OpenType GDEF glyph class: one a UFO's `public.openTypeCategories`
/// gives a glyph by name, or the one its category gives it ([`Self::of`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum OpenTypeCategory {
    Base,
    Ligature,
    Mark,
    Component,
}

impl OpenTypeCategory {
    /// The GDEF class a glyph compiles with: the class `explicit` gives it,
    /// else fontc's Glyphs rule over its own category, falling back to glyph
    /// data's (`glyph_data`). Marks are classed by category and subcategory;
    /// bases and ligatures only when the glyph carries an anchor marks attach
    /// to (`attaching_anchor`, [`Glyph::has_attaching_anchor`]). Asked
    /// through [`GlyphClasses::class`], which holds those inputs.
    fn of(
        glyph: &Glyph,
        glyph_data: GlyphDataCategory,
        explicit: Option<Self>,
        attaching_anchor: bool,
    ) -> Option<Self> {
        if explicit.is_some() {
            return explicit;
        }

        let resolved = glyph_data.resolve(glyph);
        match (resolved.category, resolved.sub_category) {
            (_, Some(GlyphSubcategory::Ligature)) if attaching_anchor => Some(Self::Ligature),
            (
                Some(GlyphCategory::Mark),
                Some(GlyphSubcategory::Nonspacing | GlyphSubcategory::SpacingCombining),
            ) => Some(Self::Mark),
            _ if attaching_anchor => Some(Self::Base),
            _ => None,
        }
    }
}

/// The classes a font lib's `public.openTypeCategories` gives, by glyph name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OpenTypeCategories<'a>(BTreeMap<&'a str, OpenTypeCategory>);

impl<'a> OpenTypeCategories<'a> {
    /// The classes `lib` sets; none when it has no `public.openTypeCategories`
    /// dictionary. An entry whose class is unknown is skipped.
    pub fn of(lib: &'a LibData) -> Self {
        let Some(LibValue::Dict(entries)) = lib.get(OPENTYPE_CATEGORIES_KEY) else {
            return Self::default();
        };
        Self(
            entries
                .iter()
                .filter_map(|(name, value)| {
                    let LibValue::String(class) = value else {
                        return None;
                    };
                    let class = match class.as_str() {
                        "base" => OpenTypeCategory::Base,
                        "ligature" => OpenTypeCategory::Ligature,
                        "mark" => OpenTypeCategory::Mark,
                        "component" => OpenTypeCategory::Component,
                        _ => return None,
                    };
                    Some((name.as_str(), class))
                })
                .collect(),
        )
    }

    /// The class given to the glyph named `name`, if any.
    pub fn class(&self, name: &str) -> Option<OpenTypeCategory> {
        self.0.get(name).copied()
    }
}

/// What decides each glyph's GDEF class ([`OpenTypeCategory::of`]): the
/// classes a font lib's `public.openTypeCategories` gives by name, glyph
/// data's category for each glyph, and which glyphs carry an anchor marks
/// attach to.
///
/// Glyph data and, for layers a session has not loaded, the anchors are the
/// store's answers; build it with [`Self::new`] from them, or with
/// [`Self::of_loaded`] when every layer is loaded and answers for itself.
#[derive(Clone, Debug)]
pub struct GlyphClasses<'a> {
    explicit: OpenTypeCategories<'a>,
    glyph_data: HashMap<GlyphId, GlyphDataCategory>,
    attaching: HashSet<GlyphId>,
}

impl<'a> GlyphClasses<'a> {
    /// Classes from `lib`'s explicit ones, glyph data's category for each
    /// glyph (`glyph_data`; a glyph it leaves out has none) and the glyphs
    /// that carry an attaching anchor (`attaching`).
    pub fn new(
        lib: &'a LibData,
        glyph_data: HashMap<GlyphId, GlyphDataCategory>,
        attaching: HashSet<GlyphId>,
    ) -> Self {
        Self {
            explicit: OpenTypeCategories::of(lib),
            glyph_data,
            attaching,
        }
    }

    /// Classes for `glyphs` with every layer loaded, so each glyph's anchors
    /// answer whether it carries an attaching anchor; `glyph_data` gives each
    /// glyph's glyph-data category.
    pub fn of_loaded<'g>(
        glyphs: impl IntoIterator<Item = &'g Glyph>,
        lib: &'a LibData,
        mut glyph_data: impl FnMut(&Glyph) -> GlyphDataCategory,
    ) -> Self {
        let mut categories = HashMap::new();
        let mut attaching = HashSet::new();
        for glyph in glyphs {
            categories.insert(glyph.id(), glyph_data(glyph));
            if glyph.has_attaching_anchor() {
                attaching.insert(glyph.id());
            }
        }
        Self::new(lib, categories, attaching)
    }

    /// The GDEF class `glyph` compiles with; `None` when it has none.
    pub fn class(&self, glyph: &Glyph) -> Option<OpenTypeCategory> {
        OpenTypeCategory::of(
            glyph,
            self.glyph_data
                .get(&glyph.id())
                .copied()
                .unwrap_or_default(),
            self.explicit.class(glyph.name()),
            self.attaching.contains(&glyph.id()),
        )
    }

    /// The class of each of `glyphs` that has one, by glyph name.
    pub fn gdef_classes<'g>(
        &self,
        glyphs: impl IntoIterator<Item = &'g Glyph>,
    ) -> BTreeMap<String, OpenTypeCategory> {
        glyphs
            .into_iter()
            .filter_map(|glyph| Some((glyph.name().to_string(), self.class(glyph)?)))
            .collect()
    }
}

/// Why anchor propagation treats a glyph as a ligature.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
#[serde(rename_all = "camelCase")]
pub enum Ligature {
    /// Classed a ligature.
    Explicit,
    /// In the ligature subcategory: a ligature once it has an attaching
    /// anchor.
    Subcategory,
}

/// What the editor and anchor propagation read from a glyph's category, as
/// export resolves it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecordCategory {
    /// In the Mark category or classed `mark`: propagation keeps a mark's own anchors.
    pub mark: bool,
    /// In the Mark category with the Nonspacing subcategory: export compiles
    /// it with no advance.
    ///
    /// Unlike [`Self::mark`], a UFO's `public.openTypeCategories` does not set
    /// it, because export zeroes advances by category alone.
    pub nonspacing_mark: bool,
    /// Ligature components number their anchors (`top_1`, `top_2`).
    pub ligature: Option<Ligature>,
}

impl RecordCategory {
    /// A glyph's record category: its own category, then glyph data's
    /// (`glyph_data`), then the class `explicit` gives it, which wins for
    /// marks and ligatures.
    pub fn of(
        glyph: &Glyph,
        glyph_data: GlyphDataCategory,
        explicit: Option<OpenTypeCategory>,
    ) -> Self {
        let resolved = glyph_data.resolve(glyph);
        let ligature = match explicit {
            Some(OpenTypeCategory::Ligature) => Some(Ligature::Explicit),
            Some(_) => None,
            None => (resolved.sub_category == Some(GlyphSubcategory::Ligature))
                .then_some(Ligature::Subcategory),
        };
        Self {
            mark: resolved.is_mark() || explicit == Some(OpenTypeCategory::Mark),
            nonspacing_mark: resolved.is_nonspacing_mark(),
            ligature,
        }
    }
}

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
        "Vowel".parse::<GlyphCategory>().unwrap_err();
    }

    #[test]
    fn a_glyphs_own_category_wins_over_glyph_data() {
        let mut letter = Glyph::new("acutecomb");
        letter.set_category(Some(GlyphCategory::Letter));
        let data = GlyphDataCategory {
            category: Some(GlyphCategory::Mark),
            sub_category: Some(GlyphSubcategory::Nonspacing),
        };

        let category = RecordCategory::of(&letter, data, None);

        assert!(!category.mark);
        assert!(!category.nonspacing_mark);
    }

    #[test]
    fn the_libs_classes_win_for_marks_and_ligatures() {
        let data = GlyphDataCategory {
            category: Some(GlyphCategory::Letter),
            sub_category: Some(GlyphSubcategory::Ligature),
        };
        let glyph = Glyph::new("f_i");

        let mark = RecordCategory::of(&glyph, data, Some(OpenTypeCategory::Mark));
        let base = RecordCategory::of(&glyph, data, Some(OpenTypeCategory::Base));
        let unclassed = RecordCategory::of(&glyph, data, None);

        assert!(mark.mark);
        assert_eq!(mark.ligature, None);
        assert_eq!(base.ligature, None);
        assert_eq!(unclassed.ligature, Some(Ligature::Subcategory));
    }

    #[test]
    fn opentype_categories_skip_unknown_classes() {
        let mut lib = LibData::new();
        lib.set(
            OPENTYPE_CATEGORIES_KEY.to_string(),
            LibValue::Dict(BTreeMap::from([
                ("f_i".to_string(), LibValue::String("ligature".to_string())),
                ("x".to_string(), LibValue::String("other".to_string())),
            ])),
        );

        let categories = OpenTypeCategories::of(&lib);

        assert_eq!(categories.class("f_i"), Some(OpenTypeCategory::Ligature));
        assert_eq!(categories.class("x"), None);
    }

    #[test]
    fn bases_and_ligatures_take_a_gdef_class_only_with_an_attaching_anchor() {
        let category = |category, sub_category| GlyphDataCategory {
            category: Some(category),
            sub_category,
        };
        let letter = category(GlyphCategory::Letter, None);
        let ligature = category(GlyphCategory::Letter, Some(GlyphSubcategory::Ligature));
        let spacing_mark = category(
            GlyphCategory::Mark,
            Some(GlyphSubcategory::SpacingCombining),
        );
        let glyph = Glyph::new("x");
        let class = |data, attaching| OpenTypeCategory::of(&glyph, data, None, attaching);

        assert_eq!(
            [false, true].map(|attaching| class(letter, attaching)),
            [None, Some(OpenTypeCategory::Base)]
        );
        assert_eq!(
            [false, true].map(|attaching| class(ligature, attaching)),
            [None, Some(OpenTypeCategory::Ligature)]
        );
        assert_eq!(
            [false, true].map(|attaching| class(spacing_mark, attaching)),
            [Some(OpenTypeCategory::Mark); 2]
        );
        assert_eq!(
            OpenTypeCategory::of(&glyph, letter, Some(OpenTypeCategory::Component), true),
            Some(OpenTypeCategory::Component)
        );
    }
}

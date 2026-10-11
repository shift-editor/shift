//! Resolves a glyph's category and its OpenType GDEF class.
//!
//! A glyph's own category wins; otherwise Glyphs' glyph data supplies one by
//! name and codepoint, so `jdotless` is a letter and `dotaccentcomb` a
//! nonspacing mark even though neither says so. The GDEF rules follow fontc's
//! Glyphs reader (after glyphsLib), and a UFO's `public.openTypeCategories`
//! overrides them glyph by glyph, as ufo2ft does.

use std::collections::{BTreeMap, BTreeSet};

use glyphs_reader::glyphdata::GlyphData;
use shift_font::{Glyph, GlyphCategory, GlyphSubcategory, LibData, LibValue};
use write_fonts::tables::gdef::GlyphClassDef;

/// Font lib key a UFO uses for explicit GDEF classes.
const OPENTYPE_CATEGORIES_KEY: &str = "public.openTypeCategories";

/// A glyph's effective category: its own where set, glyph data otherwise.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResolvedCategory {
    pub category: Option<GlyphCategory>,
    pub sub_category: Option<GlyphSubcategory>,
}

impl ResolvedCategory {
    /// Whether the glyph is a combining mark that takes no horizontal space.
    pub fn is_nonspacing_mark(self) -> bool {
        self.category == Some(GlyphCategory::Mark)
            && self.sub_category == Some(GlyphSubcategory::Nonspacing)
    }
}

/// Looks glyphs up in Glyphs' bundled glyph data.
#[derive(Default)]
pub struct GlyphCategories {
    data: GlyphData,
}

impl GlyphCategories {
    pub fn new() -> Self {
        Self::default()
    }

    /// The glyph data category for `name` and `unicodes`, if glyph data knows it.
    pub fn lookup(&self, name: &str, unicodes: &[u32]) -> ResolvedCategory {
        let codepoints: BTreeSet<u32> = unicodes.iter().copied().collect();
        let Some(result) = self.data.query(name, Some(&codepoints)) else {
            return ResolvedCategory::default();
        };
        ResolvedCategory {
            category: result.category.to_string().parse().ok(),
            sub_category: result
                .subcategory
                .and_then(|sub_category| sub_category.to_string().parse().ok()),
        }
    }

    /// The glyph's own category and subcategory, each falling back to glyph data.
    pub fn resolve(&self, glyph: &Glyph) -> ResolvedCategory {
        let looked_up = self.lookup(glyph.name(), glyph.unicodes());
        ResolvedCategory {
            category: glyph.category().or(looked_up.category),
            sub_category: glyph.sub_category().or(looked_up.sub_category),
        }
    }

    /// The overrides to store for an imported glyph whose source resolved
    /// it to `resolved`: only the parts glyph data would not supply itself.
    pub fn overrides(
        &self,
        name: &str,
        unicodes: &[u32],
        resolved: ResolvedCategory,
    ) -> ResolvedCategory {
        let looked_up = self.lookup(name, unicodes);
        ResolvedCategory {
            category: resolved
                .category
                .filter(|category| Some(*category) != looked_up.category),
            sub_category: resolved
                .sub_category
                .filter(|sub_category| Some(*sub_category) != looked_up.sub_category),
        }
    }
}

/// GDEF classes for every glyph that has one, by glyph name.
pub(crate) fn gdef_classes<'a>(
    glyphs: impl IntoIterator<Item = &'a Glyph>,
    font_lib: &LibData,
) -> BTreeMap<String, GlyphClassDef> {
    let categories = GlyphCategories::new();
    let explicit = opentype_categories(font_lib);
    glyphs
        .into_iter()
        .filter_map(|glyph| {
            let class = match explicit.get(glyph.name()) {
                Some(class) => *class,
                None => class_for(categories.resolve(glyph), has_attaching_anchor(glyph))?,
            };
            Some((glyph.name().to_string(), class))
        })
        .collect()
}

/// fontc's Glyphs rule: marks by category, and bases and ligatures only when
/// they carry an anchor something can attach to.
fn class_for(resolved: ResolvedCategory, attaching_anchor: bool) -> Option<GlyphClassDef> {
    match (resolved.category, resolved.sub_category) {
        (_, Some(GlyphSubcategory::Ligature)) if attaching_anchor => Some(GlyphClassDef::Ligature),
        (
            Some(GlyphCategory::Mark),
            Some(GlyphSubcategory::Nonspacing | GlyphSubcategory::SpacingCombining),
        ) => Some(GlyphClassDef::Mark),
        _ if attaching_anchor => Some(GlyphClassDef::Base),
        _ => None,
    }
}

/// Any anchor not starting with `_` is one marks attach to.
fn has_attaching_anchor(glyph: &Glyph) -> bool {
    glyph
        .layers()
        .values()
        .flat_map(|layer| layer.anchors())
        .any(|anchor| !anchor.name().is_some_and(|name| name.starts_with('_')))
}

fn opentype_categories(font_lib: &LibData) -> BTreeMap<&str, GlyphClassDef> {
    let Some(LibValue::Dict(entries)) = font_lib.get(OPENTYPE_CATEGORIES_KEY) else {
        return BTreeMap::new();
    };
    entries
        .iter()
        .filter_map(|(name, value)| {
            let LibValue::String(class) = value else {
                return None;
            };
            let class = match class.as_str() {
                "base" => GlyphClassDef::Base,
                "ligature" => GlyphClassDef::Ligature,
                "mark" => GlyphClassDef::Mark,
                "component" => GlyphClassDef::Component,
                _ => return None,
            };
            Some((name.as_str(), class))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::{Anchor, GlyphLayer, LayerId, SourceId};

    fn glyph_with_anchor(name: &str, unicodes: &[u32], anchor: &str) -> Glyph {
        let mut glyph = Glyph::new(name);
        glyph.set_unicodes(unicodes.to_vec());
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::new(), 500.0);
        layer.add_anchor(Anchor::new(Some(anchor.to_string()), 0.0, 0.0));
        glyph.set_layer(layer);
        glyph
    }

    #[test]
    fn glyph_data_names_unencoded_letters_and_marks() {
        let categories = GlyphCategories::new();

        assert_eq!(
            categories.lookup("jdotless", &[]).category,
            Some(GlyphCategory::Letter)
        );
        assert!(categories
            .lookup("dotaccentcomb", &[0x0307])
            .is_nonspacing_mark());
    }

    #[test]
    fn a_letter_with_an_underscore_anchor_is_not_a_mark() {
        let jdotless = glyph_with_anchor("jdotless", &[0x0237], "_right");
        let acute = glyph_with_anchor("acutecomb", &[0x0301], "_top");
        let a = glyph_with_anchor("a", &[0x61], "top");

        let classes = gdef_classes([&jdotless, &acute, &a], &LibData::new());

        assert_eq!(classes.get("jdotless"), None);
        assert_eq!(classes.get("acutecomb"), Some(&GlyphClassDef::Mark));
        assert_eq!(classes.get("a"), Some(&GlyphClassDef::Base));
    }

    #[test]
    fn a_glyphs_own_category_wins_over_glyph_data() {
        let mut glyph = glyph_with_anchor("a", &[0x61], "_top");
        glyph.set_category(Some(GlyphCategory::Mark));
        glyph.set_sub_category(Some(GlyphSubcategory::Nonspacing));

        let classes = gdef_classes([&glyph], &LibData::new());

        assert_eq!(classes.get("a"), Some(&GlyphClassDef::Mark));
    }

    #[test]
    fn ufo_opentype_categories_win_over_everything() {
        let acute = glyph_with_anchor("acutecomb", &[0x0301], "_top");
        let lib = LibData::from_map([(
            OPENTYPE_CATEGORIES_KEY.to_string(),
            LibValue::Dict(BTreeMap::from([(
                "acutecomb".to_string(),
                LibValue::String("base".to_string()),
            )])),
        )]);

        let classes = gdef_classes([&acute], &lib);

        assert_eq!(classes.get("acutecomb"), Some(&GlyphClassDef::Base));
    }

    #[test]
    fn overrides_keep_only_what_glyph_data_would_not_say() {
        let categories = GlyphCategories::new();
        let as_data_says = categories.lookup("a", &[0x61]);
        let as_mark = ResolvedCategory {
            category: Some(GlyphCategory::Mark),
            sub_category: Some(GlyphSubcategory::Nonspacing),
        };

        assert_eq!(
            categories.overrides("a", &[0x61], as_data_says),
            ResolvedCategory::default()
        );
        assert_eq!(categories.overrides("a", &[0x61], as_mark), as_mark);
    }
}

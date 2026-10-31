//! Resolves a glyph's category and its OpenType GDEF class.
//!
//! A glyph's own category wins; otherwise Glyphs' glyph data supplies one by
//! name and codepoint, so `jdotless` is a letter and `dotaccentcomb` a
//! nonspacing mark even though neither says so. The GDEF rules follow fontc's
//! Glyphs reader (after glyphsLib), and a UFO's `public.openTypeCategories`
//! overrides them glyph by glyph, as ufo2ft does. The record rule itself is
//! shift-font's ([`RecordCategory::of`]); this module looks glyph data up
//! and builds GDEF classes.

#[cfg(test)]
use std::collections::BTreeMap;
use std::collections::BTreeSet;

use glyphs_reader::glyphdata::GlyphData;
use shift_font::{Glyph, GlyphClasses, GlyphDataCategory, LibData, NamedGlyph};

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
    pub fn lookup(&self, name: &str, unicodes: &[u32]) -> GlyphDataCategory {
        let codepoints: BTreeSet<u32> = unicodes.iter().copied().collect();
        let Some(result) = self.data.query(name, Some(&codepoints)) else {
            return GlyphDataCategory::default();
        };
        GlyphDataCategory {
            category: result.category.to_string().parse().ok(),
            sub_category: result
                .subcategory
                .and_then(|sub_category| sub_category.to_string().parse().ok()),
        }
    }

    /// The glyph's own category and subcategory, each falling back to glyph data.
    pub fn resolve(&self, glyph: &Glyph) -> GlyphDataCategory {
        self.lookup(glyph.name(), glyph.unicodes()).resolve(glyph)
    }

    /// The GDEF classes of `glyphs`, with glyph data's categories and the
    /// classes `lib` gives by name. Every layer must be loaded, because a
    /// class depends on the glyph's anchors.
    pub fn classes<'a, 'g>(
        &self,
        glyphs: impl IntoIterator<Item = &'g Glyph>,
        lib: &'a LibData,
    ) -> GlyphClasses<'a> {
        GlyphClasses::of_loaded(glyphs, lib, |glyph| {
            self.lookup(glyph.name(), glyph.unicodes())
        })
    }

    /// Glyph data's category for each of `glyphs`, in order.
    pub fn lookup_all(&self, glyphs: &[NamedGlyph]) -> Vec<GlyphDataCategory> {
        glyphs
            .iter()
            .map(|glyph| self.lookup(glyph.name.as_str(), &glyph.unicodes))
            .collect()
    }

    /// The overrides to store for an imported glyph whose source resolved
    /// it to `resolved`: only the parts glyph data would not supply itself.
    pub fn overrides(
        &self,
        name: &str,
        unicodes: &[u32],
        resolved: GlyphDataCategory,
    ) -> GlyphDataCategory {
        let looked_up = self.lookup(name, unicodes);
        GlyphDataCategory {
            category: resolved
                .category
                .filter(|category| Some(*category) != looked_up.category),
            sub_category: resolved
                .sub_category
                .filter(|sub_category| Some(*sub_category) != looked_up.sub_category),
        }
    }
}

/// Each glyph's record category, by glyph id, as the editor's records carry it.
#[cfg(test)]
pub(crate) fn record_categories<'a>(
    glyphs: impl IntoIterator<Item = &'a Glyph>,
    font_lib: &LibData,
) -> BTreeMap<shift_font::GlyphId, shift_font::RecordCategory> {
    let categories = GlyphCategories::new();
    let explicit = shift_font::OpenTypeCategories::of(font_lib);
    glyphs
        .into_iter()
        .map(|glyph| {
            let glyph_data = categories.lookup(glyph.name(), glyph.unicodes());
            let category =
                shift_font::RecordCategory::of(glyph, glyph_data, explicit.class(glyph.name()));
            (glyph.id(), category)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::OpenTypeCategory;

    /// The GDEF classes of `glyphs`, with glyph data's categories.
    fn gdef_classes<const N: usize>(
        glyphs: [&Glyph; N],
        lib: &LibData,
    ) -> BTreeMap<String, OpenTypeCategory> {
        GlyphCategories::new()
            .classes(glyphs, lib)
            .gdef_classes(glyphs)
    }
    use shift_font::ir::glyph_category::OPENTYPE_CATEGORIES_KEY;
    use shift_font::{
        Anchor, GlyphCategory, GlyphLayer, GlyphSubcategory, LayerId, LibValue, SourceId,
    };

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
        assert!(
            categories
                .lookup("dotaccentcomb", &[0x0307])
                .is_nonspacing_mark()
        );
    }

    #[test]
    fn a_letter_with_an_underscore_anchor_is_not_a_mark() {
        let jdotless = glyph_with_anchor("jdotless", &[0x0237], "_right");
        let acute = glyph_with_anchor("acutecomb", &[0x0301], "_top");
        let a = glyph_with_anchor("a", &[0x61], "top");

        let classes = gdef_classes([&jdotless, &acute, &a], &LibData::new());

        assert_eq!(classes.get("jdotless"), None);
        assert_eq!(classes.get("acutecomb"), Some(&OpenTypeCategory::Mark));
        assert_eq!(classes.get("a"), Some(&OpenTypeCategory::Base));
    }

    #[test]
    fn a_glyphs_own_category_wins_over_glyph_data() {
        let mut glyph = glyph_with_anchor("a", &[0x61], "_top");
        glyph.set_category(Some(GlyphCategory::Mark));
        glyph.set_sub_category(Some(GlyphSubcategory::Nonspacing));

        let classes = gdef_classes([&glyph], &LibData::new());

        assert_eq!(classes.get("a"), Some(&OpenTypeCategory::Mark));
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

        assert_eq!(classes.get("acutecomb"), Some(&OpenTypeCategory::Base));
    }

    #[test]
    fn records_call_only_nonspacing_marks_nonspacing() {
        let acute = Glyph::new("acutecomb");
        let named_like_a_mark = Glyph::new("x.comb");
        let mut spacing_mark = Glyph::new("aaMatra-deva");
        spacing_mark.set_category(Some(GlyphCategory::Mark));
        spacing_mark.set_sub_category(Some(GlyphSubcategory::SpacingCombining));
        let mut classed_as_mark = Glyph::new("a");
        classed_as_mark.set_category(Some(GlyphCategory::Mark));
        classed_as_mark.set_sub_category(Some(GlyphSubcategory::Nonspacing));
        let glyphs = [&acute, &named_like_a_mark, &spacing_mark, &classed_as_mark];

        let records = record_categories(glyphs, &LibData::new());
        let nonspacing = |glyph: &Glyph| records[&glyph.id()].nonspacing_mark;

        assert!(nonspacing(&acute));
        assert!(!nonspacing(&named_like_a_mark));
        assert!(records[&spacing_mark.id()].mark);
        assert!(!nonspacing(&spacing_mark));
        assert!(nonspacing(&classed_as_mark));
    }

    #[test]
    fn overrides_keep_only_what_glyph_data_would_not_say() {
        let categories = GlyphCategories::new();
        let as_data_says = categories.lookup("a", &[0x61]);
        let as_mark = GlyphDataCategory {
            category: Some(GlyphCategory::Mark),
            sub_category: Some(GlyphSubcategory::Nonspacing),
        };

        assert_eq!(
            categories.overrides("a", &[0x61], as_data_says),
            GlyphDataCategory::default()
        );
        assert_eq!(categories.overrides("a", &[0x61], as_mark), as_mark);
    }
}

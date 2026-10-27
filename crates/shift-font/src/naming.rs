//! Names for new glyphs and anchors that do not clash with names already
//! taken: the name itself, or the name followed by `.1`, `.2`, and so on.

use crate::{Font, GlyphLayer};

/// The name a glyph created without one takes, before numbering.
const NEW_GLYPH_NAME: &str = "newGlyph";
/// The name a new anchor takes, before numbering, as Glyphs names it.
const NEW_ANCHOR_NAME: &str = "new";

/// `base` when `taken` says it is free, otherwise the first of `base.1`,
/// `base.2`, … that is.
pub fn next_available_name(base: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_owned();
    }
    (1_u64..)
        .map(|index| format!("{base}.{index}"))
        .find(|candidate| !taken(candidate))
        .unwrap_or_else(|| unreachable!("a name is free before the counter runs out"))
}

impl Font {
    /// The name a new glyph asked to be called `name` takes: `name` trimmed,
    /// or `newGlyph` when blank, numbered past any glyph already called that.
    pub fn next_available_glyph_name(&self, name: &str) -> String {
        let base = match name.trim() {
            "" => NEW_GLYPH_NAME,
            trimmed => trimmed,
        };
        next_available_name(base, |candidate| self.glyph_id_by_name(candidate).is_some())
    }
}

/// The name a new anchor added to every one of `layers` takes: `new`,
/// numbered past any anchor already called that in any of them.
pub fn new_anchor_name<'a>(layers: impl IntoIterator<Item = &'a GlyphLayer>) -> String {
    let layers: Vec<&GlyphLayer> = layers.into_iter().collect();
    next_available_name(NEW_ANCHOR_NAME, |candidate| {
        layers.iter().any(|layer| {
            layer
                .anchors_iter()
                .any(|anchor| anchor.name() == Some(candidate))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_font;
    use crate::{Anchor, Glyph, LayerId, SourceId};

    #[test]
    fn a_free_name_is_kept_and_a_taken_one_numbered() {
        let taken = ["a", "a.1", "b.1"];
        let is_taken = |name: &str| taken.contains(&name);

        assert_eq!(next_available_name("b", is_taken), "b");
        assert_eq!(next_available_name("a", is_taken), "a.2");
    }

    fn layer_with_anchors(names: &[&str]) -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(LayerId::new(), SourceId::from_raw("s"), 500.0);
        for name in names {
            layer.add_anchor(Anchor::new(Some((*name).to_owned()), 0.0, 0.0));
        }
        layer
    }

    #[test]
    fn a_new_glyph_is_numbered_past_the_font_glyph_names() {
        let mut font = sample_font();
        let existing = font.glyphs().next().unwrap().name().to_owned();
        font.insert_glyph(Glyph::new(format!("{existing}.1")))
            .unwrap();

        assert_eq!(
            font.next_available_glyph_name(&existing),
            format!("{existing}.2")
        );
        assert_eq!(font.next_available_glyph_name("  fresh "), "fresh");
        assert_eq!(font.next_available_glyph_name(" "), "newGlyph");
    }

    #[test]
    fn a_new_anchor_is_numbered_past_names_taken_in_any_layer() {
        let first = layer_with_anchors(&["top", "new"]);
        let second = layer_with_anchors(&["new.1"]);

        assert_eq!(new_anchor_name([&first]), "new.1");
        assert_eq!(new_anchor_name([&first, &second]), "new.2");
        assert_eq!(new_anchor_name([&layer_with_anchors(&["top"])]), "new");
    }
}

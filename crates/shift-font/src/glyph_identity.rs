//! What a rename or a new primary codepoint does to a glyph's identity, and
//! why one is refused.
//!
//! The editor asks these before it sends an `UpdateGlyph` intent, so the
//! glyph name and codepoint fields can say why an edit did nothing.

use crate::error::CoreResult;
use crate::ir::{Font, GlyphId, GlyphName};

/// Why a glyph's name or primary codepoint was not changed.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum GlyphIdentityConflict {
    /// The name is empty once its surrounding whitespace is dropped.
    BlankName,
    /// The name is not a valid glyph name.
    InvalidName { name: String },
    /// Another glyph already has the name.
    NameTaken { name: String },
    /// Another glyph already has the codepoint, which maps to one glyph.
    CodepointTaken { codepoint: u32, owner: String },
}

/// What an identity edit does: nothing, a new name and codepoints, or a refusal.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum GlyphIdentityChange {
    /// The glyph already has this identity.
    Unchanged,
    /// The name and codepoints the glyph would have.
    Changed { name: String, unicodes: Vec<u32> },
    /// Why the edit is refused.
    Refused { conflict: GlyphIdentityConflict },
}

impl GlyphIdentityChange {
    fn refused(conflict: GlyphIdentityConflict) -> Self {
        Self::Refused { conflict }
    }
}

impl Font {
    /// What renaming glyph `glyph_id` to `name` does.
    ///
    /// Surrounding whitespace is dropped. A blank or invalid name, or one
    /// another glyph has, is refused; the glyph's own name is unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`crate::error::CoreError::GlyphNotFound`] when the glyph is missing.
    pub fn glyph_rename(&self, glyph_id: GlyphId, name: &str) -> CoreResult<GlyphIdentityChange> {
        let glyph = self.require_glyph(glyph_id)?;
        let name = name.trim();
        if name == glyph.name() {
            return Ok(GlyphIdentityChange::Unchanged);
        }
        if name.is_empty() {
            return Ok(GlyphIdentityChange::refused(
                GlyphIdentityConflict::BlankName,
            ));
        }
        if GlyphName::new(name).is_err() {
            return Ok(GlyphIdentityChange::refused(
                GlyphIdentityConflict::InvalidName {
                    name: name.to_owned(),
                },
            ));
        }
        if self.glyph_id_by_name(name).is_some() {
            return Ok(GlyphIdentityChange::refused(
                GlyphIdentityConflict::NameTaken {
                    name: name.to_owned(),
                },
            ));
        }

        Ok(GlyphIdentityChange::Changed {
            name: name.to_owned(),
            unicodes: glyph.unicodes().to_vec(),
        })
    }

    /// What making `codepoint` glyph `glyph_id`'s primary codepoint does.
    ///
    /// The codepoint replaces the primary one and the glyph keeps its others;
    /// `None` removes the primary one. A codepoint another glyph has is
    /// refused, since one codepoint maps to one glyph.
    ///
    /// # Errors
    ///
    /// Returns [`crate::error::CoreError::GlyphNotFound`] when the glyph is missing.
    pub fn glyph_primary_codepoint(
        &self,
        glyph_id: GlyphId,
        codepoint: Option<u32>,
    ) -> CoreResult<GlyphIdentityChange> {
        let glyph = self.require_glyph(glyph_id)?;
        let (primary, others) = match glyph.unicodes().split_first() {
            Some((primary, others)) => (Some(*primary), others),
            None => (None, &[][..]),
        };
        if codepoint == primary {
            return Ok(GlyphIdentityChange::Unchanged);
        }

        let Some(codepoint) = codepoint else {
            return Ok(GlyphIdentityChange::Changed {
                name: glyph.name().to_owned(),
                unicodes: others.to_vec(),
            });
        };
        if let Some(owner) = self
            .glyphs_by_unicode(codepoint)
            .find(|candidate| candidate.id() != glyph_id)
        {
            return Ok(GlyphIdentityChange::refused(
                GlyphIdentityConflict::CodepointTaken {
                    codepoint,
                    owner: owner.name().to_owned(),
                },
            ));
        }

        let unicodes = std::iter::once(codepoint)
            .chain(others.iter().copied().filter(|other| *other != codepoint))
            .collect();
        Ok(GlyphIdentityChange::Changed {
            name: glyph.name().to_owned(),
            unicodes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::Glyph;

    fn font_with(glyphs: &[(&str, &[u32])]) -> (Font, Vec<GlyphId>) {
        let mut font = Font::default();
        let ids = glyphs
            .iter()
            .map(|(name, unicodes)| {
                let mut glyph = Glyph::new(GlyphName::new(*name).expect("a glyph name"));
                glyph.set_unicodes(unicodes.to_vec());
                let id = glyph.id();
                font.insert_glyph(glyph).expect("a new glyph");
                id
            })
            .collect();
        (font, ids)
    }

    #[test]
    fn renames_a_glyph_and_refuses_blank_or_taken_names() {
        let (font, ids) = font_with(&[("A", &[0x41]), ("B", &[0x42])]);
        let a = ids[0];

        assert_eq!(
            font.glyph_rename(a, " A.alt ").expect("a glyph"),
            GlyphIdentityChange::Changed {
                name: "A.alt".into(),
                unicodes: vec![0x41]
            }
        );
        assert_eq!(
            font.glyph_rename(a, "A").expect("a glyph"),
            GlyphIdentityChange::Unchanged
        );
        assert_eq!(
            font.glyph_rename(a, "  ").expect("a glyph"),
            GlyphIdentityChange::refused(GlyphIdentityConflict::BlankName)
        );
        assert_eq!(
            font.glyph_rename(a, "B").expect("a glyph"),
            GlyphIdentityChange::refused(GlyphIdentityConflict::NameTaken { name: "B".into() })
        );
    }

    #[test]
    fn replaces_the_primary_codepoint_and_refuses_one_another_glyph_has() {
        let (font, ids) = font_with(&[("A", &[0x41, 0xC0]), ("B", &[0x42])]);
        let a = ids[0];

        assert_eq!(
            font.glyph_primary_codepoint(a, Some(0xE000))
                .expect("a glyph"),
            GlyphIdentityChange::Changed {
                name: "A".into(),
                unicodes: vec![0xE000, 0xC0]
            }
        );
        assert_eq!(
            font.glyph_primary_codepoint(a, Some(0x42))
                .expect("a glyph"),
            GlyphIdentityChange::refused(GlyphIdentityConflict::CodepointTaken {
                codepoint: 0x42,
                owner: "B".into(),
            })
        );
        assert_eq!(
            font.glyph_primary_codepoint(a, None).expect("a glyph"),
            GlyphIdentityChange::Changed {
                name: "A".into(),
                unicodes: vec![0xC0]
            }
        );
        assert_eq!(
            font.glyph_primary_codepoint(a, Some(0x41))
                .expect("a glyph"),
            GlyphIdentityChange::Unchanged
        );
    }
}

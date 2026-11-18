//! Alternates: where on the font's axes text draws another glyph in a
//! glyph's place.
//!
//! A glyph's alternates are ordered and the first whose condition holds is
//! the glyph text draws instead, the way a designspace rule or an `rvrn`
//! substitution swaps one glyph for another (`dollar.heavy` is an alternate
//! of `dollar`). When none holds, the glyph draws itself. It is one step: an
//! alternate glyph's own alternates are not applied. It applies wherever the
//! glyph is drawn as itself at a font location (text, previews, the glyph
//! open for editing), never to a component: a component of the glyph still
//! draws the glyph.

use serde::{Deserialize, Serialize};

use crate::condition::Condition;
use crate::entity::{AlternateId, GlyphId};

/// One of a glyph's alternates: where its condition holds on the font's
/// axes, text draws `glyph` in the glyph's place.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GlyphAlternate {
    id: AlternateId,
    condition: Condition,
    glyph: GlyphId,
}

impl GlyphAlternate {
    /// An alternate that draws `glyph_id` where `condition` holds.
    pub fn new(id: AlternateId, condition: Condition, glyph_id: GlyphId) -> Self {
        Self {
            id,
            condition,
            glyph: glyph_id,
        }
    }

    pub fn id(&self) -> AlternateId {
        self.id
    }

    /// Where the alternate applies, on font axes only.
    pub fn condition(&self) -> &Condition {
        &self.condition
    }

    /// The glyph drawn where the alternate applies.
    pub fn glyph(&self) -> GlyphId {
        self.glyph
    }
}

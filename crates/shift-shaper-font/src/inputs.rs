//! The parts of what a shaper font compiles from, each saying whether a new
//! value of it can compile to a different font.

use std::collections::{BTreeMap, HashMap, HashSet};

use fontdrasil::types::Axis as IrAxis;
use shift_font::{AxisId, GlyphId};
use write_fonts::tables::gdef::GlyphClassDef;

use super::ShaperFontError;
use super::references::FeatureReferences;

const MIN_UNITS_PER_EM: f64 = 16.0;
const MAX_UNITS_PER_EM: f64 = 16_384.0;

/// One part of what a shaper font compiles from.
pub(crate) trait CompileInput {
    /// Whether compiling with `next` in place of this part can give a
    /// different font.
    fn recompiles(&self, next: &Self) -> bool;
}

/// Units per em as a font's `head` table holds them: a whole number from 16
/// to 16384.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnitsPerEm(u16);

impl UnitsPerEm {
    /// The `head` value.
    pub fn get(self) -> u16 {
        self.0
    }
}

impl TryFrom<f64> for UnitsPerEm {
    type Error = ShaperFontError;

    /// # Errors
    ///
    /// Returns [`ShaperFontError::InvalidUnitsPerEm`] when `value` is not a
    /// whole number from 16 to 16384.
    fn try_from(value: f64) -> Result<Self, ShaperFontError> {
        let valid = value.fract() == 0.0 && (MIN_UNITS_PER_EM..=MAX_UNITS_PER_EM).contains(&value);
        if !valid {
            return Err(ShaperFontError::InvalidUnitsPerEm { value });
        }
        // In range and whole, so the conversion is exact.
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "checked whole and within 16..=16384 above"
        )]
        Ok(Self(value as u16))
    }
}

impl CompileInput for UnitsPerEm {
    fn recompiles(&self, next: &Self) -> bool {
        self != next
    }
}

/// The authored feature source.
#[derive(Clone, Debug, Default)]
pub(crate) struct FeatureSource(pub(crate) String);

impl FeatureSource {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl CompileInput for FeatureSource {
    fn recompiles(&self, next: &Self) -> bool {
        self.0 != next.0
    }
}

/// The axes, each with the Shift axis it is.
#[derive(Clone, Debug, Default)]
pub(crate) struct ShaperAxes {
    pub(crate) axes: Vec<IrAxis>,
    /// The Shift axis for each axis in `axes`.
    pub(crate) ids: Vec<AxisId>,
}

impl CompileInput for ShaperAxes {
    fn recompiles(&self, next: &Self) -> bool {
        self.axes != next.axes || self.ids != next.ids
    }
}

/// The glyph order, `.notdef` first, and each glyph's `GDEF` class by name.
#[derive(Clone, Debug, Default)]
pub(crate) struct GlyphSet {
    pub(crate) names: Vec<String>,
    /// The Shift glyph for each name in `names`; `None` for a `.notdef` the
    /// font does not have.
    pub(crate) ids: Vec<Option<GlyphId>>,
    pub(crate) gdef_classes: BTreeMap<String, GlyphClassDef>,
}

impl GlyphSet {
    /// Each Shift glyph past `.notdef`, with its name and class.
    fn glyphs(&self) -> impl Iterator<Item = (GlyphId, &str, Option<GlyphClassDef>)> {
        self.ids
            .iter()
            .zip(&self.names)
            .skip(1)
            .filter_map(|(id, name)| {
                Some(((*id)?, name.as_str(), self.gdef_classes.get(name).copied()))
            })
    }
}

/// How a glyph set differs from the one a compile read, when it compiles
/// the same.
pub(crate) struct GlyphChange {
    /// Glyphs it adds, in its glyph order.
    pub(crate) added: Vec<GlyphId>,
    /// Whether it removes any glyph.
    pub(crate) removed: bool,
}

/// The glyph set a compile read, indexed for comparing the next one against,
/// with the glyphs its feature source names.
#[derive(Debug)]
pub(crate) struct CompiledGlyphs {
    notdef: Option<GlyphId>,
    glyphs: HashMap<GlyphId, (String, Option<GlyphClassDef>)>,
    references: FeatureReferences,
}

impl CompiledGlyphs {
    pub(crate) fn new(set: &GlyphSet, references: FeatureReferences) -> Self {
        Self {
            notdef: set.ids.first().copied().flatten(),
            glyphs: set
                .glyphs()
                .map(|(id, name, class)| (id, (name.to_string(), class)))
                .collect(),
            references,
        }
    }

    /// How `next` differs, or `None` when it compiles differently: a glyph
    /// the feature source names is added, removed or renamed (any glyph, for
    /// a source that names glyphs by order), a glyph's class changes, a
    /// glyph is added with a class, or `.notdef` changes.
    pub(crate) fn change(&self, next: &GlyphSet) -> Option<GlyphChange> {
        if next.ids.first().copied().flatten() != self.notdef {
            return None;
        }
        let named = |name: &str| self.references.names(name);
        let mut added = Vec::new();
        let mut kept = 0;
        for (glyph_id, name, class) in next.glyphs() {
            let Some((before_name, before_class)) = self.glyphs.get(&glyph_id) else {
                if named(name) || class.is_some() {
                    return None;
                }
                added.push(glyph_id);
                continue;
            };
            kept += 1;
            let renamed = before_name != name && (named(before_name) || named(name));
            if renamed || class != *before_class {
                return None;
            }
        }
        let removed = kept < self.glyphs.len();
        if removed && self.removes_a_compile_input(next) {
            return None;
        }
        if self.references.by_order() && (removed || !added.is_empty()) {
            return None;
        }
        Some(GlyphChange { added, removed })
    }

    /// Whether a glyph `next` no longer has is one the feature source names
    /// or one with a `GDEF` class.
    fn removes_a_compile_input(&self, next: &GlyphSet) -> bool {
        let present: HashSet<GlyphId> = next.ids.iter().flatten().copied().collect();
        self.glyphs.iter().any(|(glyph_id, (name, class))| {
            !present.contains(glyph_id) && (self.references.names(name) || class.is_some())
        })
    }
}

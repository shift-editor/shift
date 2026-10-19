//! Spike 4: shaping from the engine's live font, and when it must refresh.
//!
//! The engine holds the authored font; the workspace compiles the shaper font
//! (GSUB/GPOS/GDEF/fvar) from it. Shaping needs three things from the engine,
//! each with its own cost to refresh:
//!
//! - the shaper font, compiled natively: glyph order, GDEF classes, feature
//!   source, axes (expensive, asynchronous);
//! - the character map, built from live Unicode values through the shaper
//!   font's glyph order (cheap, synchronous);
//! - advances, which shaping leaves at zero and layout adds from the live
//!   font (no reshape at all).

use std::collections::HashMap;
use std::sync::Arc;

use shift_backends::shaper_font::{ShaperFont, ShaperFontRequest, ShaperFontState};
use shift_backends::{gdef_class, GlyphCategories, OPENTYPE_CATEGORIES_KEY};
use shift_font::{Font, FontChange, FontChangeSet, Glyph, GlyphId};
use shift_shape::{
    character_glyphs, GlyphSource, NormalizedCoord, ParagraphRequest, ShapedParagraph, Shaper,
    Unit, NOTDEF,
};

/// The engine's live glyphs as the shaper sees them: identity through the
/// shaper font's glyph order, characters through live Unicode values, and
/// zero advances (layout adds live ones).
pub struct EngineGlyphs {
    glyph_ids: Vec<Option<GlyphId>>,
    shaper_glyphs: HashMap<GlyphId, u32>,
    characters: HashMap<u32, u32>,
}

impl EngineGlyphs {
    pub fn new(shaper_font: &ShaperFont, live: &Font) -> Self {
        let glyph_ids = shaper_font.glyph_ids().to_vec();
        let shaper_glyphs: HashMap<GlyphId, u32> = glyph_ids
            .iter()
            .enumerate()
            .filter_map(|(index, id)| Some((id.clone()?, u32::try_from(index).ok()?)))
            .collect();
        let mut glyphs = Self {
            glyph_ids,
            shaper_glyphs,
            characters: HashMap::new(),
        };
        glyphs.remap(live);
        glyphs
    }

    /// Rebuilds the character map from live Unicode values; the shaper font
    /// and its parsed tables stay as they are.
    pub fn remap(&mut self, live: &Font) {
        let shaper_glyphs = &self.shaper_glyphs;
        self.characters = character_glyphs(live.glyphs().flat_map(|glyph| {
            let shaper_glyph = shaper_glyphs.get(&glyph.id()).copied();
            glyph
                .unicodes()
                .iter()
                .filter_map(move |&codepoint| Some((codepoint, shaper_glyph?)))
                .collect::<Vec<_>>()
        }));
    }

    /// The `(codepoint, shaper glyph)` pairs the editor registers in bulk.
    pub fn registration(&self) -> (Vec<f64>, Vec<f64>) {
        let mut pairs: Vec<_> = self.characters.iter().collect();
        pairs.sort();
        pairs
            .into_iter()
            .map(|(&codepoint, &glyph)| (f64::from(codepoint), f64::from(glyph)))
            .unzip()
    }
}

impl GlyphSource for EngineGlyphs {
    type Glyph = GlyphId;

    fn shaper_glyph(&self, glyph: &GlyphId) -> Option<u32> {
        self.shaper_glyphs.get(glyph).copied()
    }

    fn host_glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
        if shaper_glyph == NOTDEF {
            return None;
        }
        self.glyph_ids.get(usize::try_from(shaper_glyph).ok()?)?.clone()
    }

    fn character_glyph(&self, codepoint: u32) -> Option<u32> {
        self.characters.get(&codepoint).copied()
    }

    fn advance(&self, _shaper_glyph: u32) -> Option<i32> {
        Some(0)
    }
}

/// What an engine change requires of shaping.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ShapingInvalidation {
    /// Rebuild the character map (live Unicode values or glyph identities).
    pub cmap: bool,
    /// Recompile the shaper font (glyph order and names, GDEF classes,
    /// feature source, axes); a new shaper font also needs a new map.
    pub shaper_font: bool,
    /// Lay out again with live advances or kerning; shaped glyphs are unchanged.
    pub advances: bool,
}

impl ShapingInvalidation {
    fn merge(&mut self, other: Self) {
        self.cmap |= other.cmap;
        self.shaper_font |= other.shaper_font;
        self.advances |= other.advances;
    }
}

/// Classifies what a changeset requires of shaping.
///
/// `after` is the font the changeset produced; a glyph's GDEF class depends
/// on every one of its layers, so a layer change is judged on the whole glyph.
pub fn shaping_invalidation(changes: &FontChangeSet, after: &Font) -> ShapingInvalidation {
    let categories = GlyphCategories::new();
    let lib = after.lib();
    let class = |glyph: &Glyph| gdef_class(&categories, glyph, lib);
    let mut result = ShapingInvalidation::default();
    for change in &changes.changes {
        let next = match change {
            FontChange::Glyph(value) => match (&value.before, &value.after) {
                (Some(before), Some(after)) => ShapingInvalidation {
                    cmap: before.unicodes() != after.unicodes(),
                    shaper_font: before.name() != after.name() || class(before) != class(after),
                    advances: false,
                },
                // Creation or removal changes glyph order.
                _ => ShapingInvalidation {
                    cmap: true,
                    shaper_font: true,
                    advances: true,
                },
            },
            FontChange::Layer {
                glyph_id, layer, ..
            } => {
                let width = |layer: &Option<Arc<shift_font::GlyphLayer>>| {
                    layer.as_ref().map(|layer| layer.width())
                };
                let class_changed = after.glyph(glyph_id).is_some_and(|glyph_after| {
                    let mut glyph_before = glyph_after.clone();
                    match &layer.before {
                        Some(before) => glyph_before.set_layer((**before).clone()),
                        None => {
                            if let Some(after) = &layer.after {
                                glyph_before.remove_layer(after.id());
                            }
                        }
                    }
                    class(&glyph_before) != class(glyph_after)
                });
                ShapingInvalidation {
                    cmap: false,
                    shaper_font: class_changed,
                    advances: width(&layer.before) != width(&layer.after),
                }
            }
            FontChange::FeatureSource(_)
            | FontChange::Axes(_)
            | FontChange::AxisMappings(_) => ShapingInvalidation {
                shaper_font: true,
                ..Default::default()
            },
            FontChange::LibValue { key, .. } if key == OPENTYPE_CATEGORIES_KEY => {
                ShapingInvalidation {
                    shaper_font: true,
                    ..Default::default()
                }
            }
            FontChange::KerningValue { .. } | FontChange::KerningGroup { .. } => {
                ShapingInvalidation {
                    advances: true,
                    ..Default::default()
                }
            }
            _ => ShapingInvalidation::default(),
        };
        result.merge(next);
    }
    result
}

/// Shaping as the editor would keep it beside the engine: the latest shaper
/// font (keeping the last valid one when feature source has errors), its
/// parsed tables, and the live character map.
pub struct EngineShaping {
    fonts: ShaperFontState,
    shaper: Option<(Arc<ShaperFont>, Shaper)>,
    glyphs: Option<EngineGlyphs>,
}

impl EngineShaping {
    pub fn new(live: &Font) -> Self {
        let mut shaping = Self {
            fonts: ShaperFontState::default(),
            shaper: None,
            glyphs: None,
        };
        shaping.recompile(live);
        shaping
    }

    /// Recompiles the shaper font (the workspace's job) and remaps.
    pub fn recompile(&mut self, live: &Font) {
        let request = ShaperFontRequest::from_font(live).expect("shaper font request");
        self.fonts.update(request).expect("shaper font compiles");
        let font = self.fonts.font().expect("a shaper font").clone();
        let reparse = self
            .shaper
            .as_ref()
            .is_none_or(|(current, _)| !Arc::ptr_eq(current, &font));
        if reparse {
            let shaper = Shaper::new(font.bytes().to_vec()).expect("shaper parses");
            self.shaper = Some((font.clone(), shaper));
        }
        self.glyphs = Some(EngineGlyphs::new(&font, live));
    }

    pub fn remap(&mut self, live: &Font) {
        self.glyphs.as_mut().expect("glyphs").remap(live);
    }

    /// Applies what a change requires: remap, recompile, or nothing.
    pub fn refresh(&mut self, invalidation: ShapingInvalidation, live: &Font) {
        if invalidation.shaper_font {
            self.recompile(live);
        } else if invalidation.cmap {
            self.remap(live);
        }
    }

    pub fn glyphs(&self) -> &EngineGlyphs {
        self.glyphs.as_ref().expect("glyphs")
    }

    pub fn diagnostics(&self) -> usize {
        self.fonts.diagnostics().len()
    }

    /// Shapes every corpus line at the default location.
    pub fn shape_corpus(&self, corpus: &[Vec<Unit<GlyphId>>]) -> Vec<ShapedParagraph<GlyphId>> {
        let (font, shaper) = self.shaper.as_ref().expect("shaper");
        let coords: Vec<NormalizedCoord> = font
            .axis_normalizations()
            .iter()
            .map(|(_, normalization)| normalization.normalize(None))
            .collect();
        corpus
            .iter()
            .map(|units| {
                let request = ParagraphRequest {
                    units,
                    location: coords.as_slice(),
                    language: None,
                    features: &[],
                };
                shaper
                    .shape_paragraph(self.glyphs(), &request)
                    .expect("paragraph shapes")
            })
            .collect()
    }
}

/// Units for a line of text, with `{name}` inserting a glyph by name.
pub fn units(font: &Font, text: &str) -> Vec<Unit<GlyphId>> {
    let mut units = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        units.extend(rest[..start].chars().map(Unit::Character));
        let end = rest[start..].find('}').expect("closing brace") + start;
        let name = &rest[start + 1..end];
        units.push(Unit::Glyph(
            font.glyph_id_by_name(name).expect("inserted glyph exists"),
        ));
        rest = &rest[end + 1..];
    }
    units.extend(rest.chars().map(Unit::Character));
    units
}

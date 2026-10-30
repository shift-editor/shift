//! Text shaping in the editor: shift-shape over the shaper font the
//! workspace compiled.
//!
//! The exports exist only with the `shaping` feature, which builds them into
//! `@shift/wasm/shaping`, a module of its own that the editor loads when
//! text first needs shaping. The [`Shaping`] interface and its types are
//! declared either way, so the editor's side generates without the feature.
//!
//! This module is a separate instance from `@shift/wasm`, with its own name
//! table: glyph and axis ids, tags and language tags cross as names in it.

use pack::Pack;
use shift_font::{AxisId, GlyphId};

/// Text shaping with shapers registered with `registerShaper`.
#[pack::interface]
pub trait Shaping {
    /// Sets a registered shaper's glyphs, axes and character mapping; false
    /// for an unregistered shaper.
    fn set_shaper_glyphs(&self, glyphs: ShaperGlyphs) -> bool;
    /// Shapes paragraphs with a registered shaper: each paragraph's runs in
    /// logical order, or null for a paragraph that cannot be shaped; every
    /// paragraph is null for an unregistered shaper.
    fn shape_paragraphs(
        &self,
        shaper: usize,
        paragraphs: Vec<ParagraphRequest>,
    ) -> Vec<Option<Vec<ShapedRun>>>;
}

/// One `fvar` axis of a shaper font, and how its user coordinates normalize
/// at each mapping point, clamped outside them.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShaperAxis {
    pub axis_id: AxisId,
    /// User coordinate at each mapping point, increasing.
    pub user: Vec<f64>,
    /// Normalized coordinate at each mapping point.
    pub normalized: Vec<f64>,
}

/// A character and the glyph that claims it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct CharacterGlyph {
    pub codepoint: u32,
    pub glyph_id: GlyphId,
}

/// What a registered shaper shapes with: the glyph at each shaper glyph id,
/// the font's axes in `fvar` order, and which glyph each character maps to.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShaperGlyphs {
    pub shaper: usize,
    /// The Shift glyph at each shaper glyph id; null for a `.notdef` the font
    /// does not have.
    pub glyph_ids: Vec<Option<GlyphId>>,
    pub axes: Vec<ShaperAxis>,
    /// Characters the font's glyphs claim; a character two glyphs claim maps
    /// to the first in shaper glyph order.
    pub characters: Vec<CharacterGlyph>,
}

/// One unit of text to shape.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum ShapeUnit {
    /// A Unicode scalar value.
    Character { codepoint: u32 },
    /// A glyph with no character to type, shaped as itself.
    Glyph { glyph_id: GlyphId },
}

/// A user-space coordinate on one axis.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct AxisCoordinate {
    pub axis_id: AxisId,
    pub value: f64,
}

/// A feature setting for every run of a paragraph.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct FeatureSetting {
    /// A feature tag such as `liga`.
    pub tag: String,
    /// `0` turns the feature off, `1` on; larger values pick an alternate.
    pub value: u32,
}

/// A paragraph to shape, split into runs of one script.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ParagraphRequest {
    pub units: Vec<ShapeUnit>,
    /// User-space location to shape at; axes left out are at their default.
    pub location: Vec<AxisCoordinate>,
    /// BCP 47 language tag; the default language system when null.
    pub language: Option<String>,
    /// Settings over the features applied by default.
    pub features: Vec<FeatureSetting>,
}

/// The direction a run's glyphs read in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pack)]
pub enum TextDirection {
    #[default]
    Ltr,
    Rtl,
}

/// One shaped glyph. Advances and offsets hold only what the font's feature
/// code positions; glyph advances, kerning, and mark attachment are the
/// caller's to add.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShapedGlyph {
    /// Null when a character has no glyph.
    pub glyph_id: Option<GlyphId>,
    /// Index of the first unit the glyph came from.
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
}

/// One run of a shaped paragraph, in one script and direction.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShapedRun {
    /// First paragraph unit in the run.
    pub start: u32,
    /// One past the last paragraph unit in the run.
    pub end: u32,
    /// ISO 15924 script tag such as `Arab`; null when the run holds only
    /// characters common to all scripts.
    pub script: Option<String>,
    pub direction: TextDirection,
    /// Glyphs in visual order; clusters index the paragraph's units.
    pub glyphs: Vec<ShapedGlyph>,
}

#[cfg(feature = "shaping")]
mod exports {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use shift_font::{AxisId, GlyphId};
    use shift_shape::{
        AxisNormalization, GlyphSource, NOTDEF, ShapeError, Shaper, Tag, Unit, character_glyphs,
    };
    use wasm_bindgen::prelude::*;

    use super::{
        ParagraphRequest, ShapeUnit, ShapedGlyph, ShapedRun, ShaperGlyphs, Shaping, TextDirection,
        shaping_request,
    };
    use crate::names::with_names;

    thread_local! {
        static SHAPERS: RefCell<Vec<Option<Registered>>> = const { RefCell::new(Vec::new()) };
    }

    /// A shaper font registered from the editor, and the editor's view of it.
    struct Registered {
        shaper: Shaper,
        glyphs: EditorGlyphs,
    }

    /// Glyphs as the editor names them, by id, with characters mapped from
    /// the live font and zero advances, which the editor replaces with live
    /// ones.
    #[derive(Default)]
    struct EditorGlyphs {
        /// The glyph at each shaper glyph id.
        glyph_ids: Vec<Option<GlyphId>>,
        shaper_glyphs: HashMap<GlyphId, u32>,
        characters: HashMap<u32, u32>,
        axes: Vec<(AxisId, AxisNormalization)>,
    }

    impl EditorGlyphs {
        fn new(glyphs: ShaperGlyphs) -> Self {
            let shaper_glyphs: HashMap<GlyphId, u32> = glyphs
                .glyph_ids
                .iter()
                .enumerate()
                .filter_map(|(index, glyph_id)| {
                    Some((glyph_id.as_ref().copied()?, u32::try_from(index).ok()?))
                })
                .collect();
            let characters = character_glyphs(glyphs.characters.iter().filter_map(|character| {
                Some((
                    character.codepoint,
                    *shaper_glyphs.get(&character.glyph_id)?,
                ))
            }));
            let axes = glyphs
                .axes
                .into_iter()
                .map(|axis| {
                    let normalization = AxisNormalization::new(
                        axis.user.into_iter().zip(axis.normalized).collect(),
                    );
                    (axis.axis_id, normalization)
                })
                .collect();
            Self {
                glyph_ids: glyphs.glyph_ids,
                shaper_glyphs,
                characters,
                axes,
            }
        }
    }

    impl GlyphSource for EditorGlyphs {
        type Glyph = GlyphId;

        fn shaper_glyph(&self, glyph: &GlyphId) -> Option<u32> {
            self.shaper_glyphs.get(glyph).copied()
        }

        fn host_glyph(&self, shaper_glyph: u32) -> Option<GlyphId> {
            if shaper_glyph == NOTDEF {
                return None;
            }
            *self.glyph_ids.get(usize::try_from(shaper_glyph).ok()?)?
        }

        fn character_glyph(&self, codepoint: u32) -> Option<u32> {
            self.characters.get(&codepoint).copied()
        }

        fn advance(&self, _shaper_glyph: u32) -> Option<i32> {
            Some(0)
        }
    }

    /// Registers a shaper font's bytes and returns its handle. Parses the
    /// font's layout tables once; set its glyphs with `setShaperGlyphs`.
    #[wasm_bindgen(js_name = registerShaper)]
    pub fn register_shaper(bytes: &[u8]) -> Result<u32, JsError> {
        let shaper = Shaper::new(bytes.to_vec())?;
        SHAPERS.with_borrow_mut(|shapers| {
            let handle = u32::try_from(shapers.len())?;
            shapers.push(Some(Registered {
                shaper,
                glyphs: EditorGlyphs::default(),
            }));
            Ok(handle)
        })
    }

    /// Releases a registered shaper; its handle shapes nothing afterwards.
    #[wasm_bindgen(js_name = releaseShaper)]
    pub fn release_shaper(handle: u32) {
        SHAPERS.with_borrow_mut(|shapers| {
            if let Some(slot) = usize::try_from(handle)
                .ok()
                .and_then(|index| shapers.get_mut(index))
            {
                *slot = None;
            }
        });
    }

    /// The registered shapers [`Shaping`] calls.
    pub struct Shapers;

    impl Shaping for Shapers {
        fn set_shaper_glyphs(&self, glyphs: ShaperGlyphs) -> bool {
            SHAPERS.with_borrow_mut(|shapers| {
                let Some(Some(registered)) = shapers.get_mut(glyphs.shaper) else {
                    return false;
                };
                registered.glyphs = EditorGlyphs::new(glyphs);
                true
            })
        }

        fn shape_paragraphs(
            &self,
            shaper: usize,
            paragraphs: Vec<ParagraphRequest>,
        ) -> Vec<Option<Vec<ShapedRun>>> {
            SHAPERS.with_borrow(|shapers| {
                let registered = shapers.get(shaper).and_then(Option::as_ref);
                paragraphs
                    .iter()
                    .map(|paragraph| {
                        registered.and_then(|registered| shape(registered, paragraph).ok())
                    })
                    .collect()
            })
        }
    }

    /// Runs one [`Shaping`] method for the editor's generated `Shaping`
    /// class.
    #[wasm_bindgen(js_name = shapingRequest)]
    pub fn request(method: u32, input: &[f64]) -> Vec<f64> {
        with_names(|names| shaping_request(&Shapers, method, input, names))
    }

    fn shape(
        registered: &Registered,
        paragraph: &ParagraphRequest,
    ) -> Result<Vec<ShapedRun>, ShapeError> {
        let units: Vec<Unit<GlyphId>> = paragraph
            .units
            .iter()
            .filter_map(|unit| match unit {
                ShapeUnit::Character { codepoint } => {
                    char::from_u32(*codepoint).map(Unit::Character)
                }
                ShapeUnit::Glyph { glyph_id } => Some(Unit::Glyph(*glyph_id)),
            })
            .collect();
        let coords: Vec<_> = registered
            .glyphs
            .axes
            .iter()
            .map(|(axis_id, normalization)| {
                let user = paragraph
                    .location
                    .iter()
                    .find(|coordinate| coordinate.axis_id == *axis_id)
                    .map(|coordinate| coordinate.value);
                normalization.normalize(user)
            })
            .collect();
        let features: Vec<_> = paragraph
            .features
            .iter()
            .filter_map(|feature| {
                Some(shift_shape::FeatureSetting {
                    tag: Tag::new_checked(feature.tag.as_bytes()).ok()?,
                    value: feature.value,
                })
            })
            .collect();
        let runs = registered.shaper.shape_paragraph(
            &registered.glyphs,
            &shift_shape::ParagraphRequest {
                units: &units,
                location: coords.as_slice(),
                language: paragraph.language.as_deref(),
                features: &features,
            },
        )?;
        Ok(runs
            .into_iter()
            .map(|run| ShapedRun {
                start: run.units.start,
                end: run.units.end,
                script: run.script,
                direction: match run.direction {
                    shift_shape::TextDirection::LeftToRight => TextDirection::Ltr,
                    shift_shape::TextDirection::RightToLeft => TextDirection::Rtl,
                },
                glyphs: run
                    .glyphs
                    .into_iter()
                    .map(|glyph| ShapedGlyph {
                        glyph_id: glyph.glyph_id,
                        cluster: glyph.cluster,
                        x_advance: glyph.x_advance,
                        y_advance: glyph.y_advance,
                        x_offset: glyph.x_offset,
                        y_offset: glyph.y_offset,
                    })
                    .collect(),
            })
            .collect())
    }
}

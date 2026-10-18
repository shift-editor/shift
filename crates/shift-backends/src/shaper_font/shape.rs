use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use fontdrasil::coords::UserCoord;
use shift_font::{ExternalLocation, GlyphId};
use shift_shape::{GlyphSource, NormalizedCoord, Shaper, Unit, NOTDEF};

pub use shift_shape::{FeatureSetting, ShapeError, TextDirection};

use super::ShaperFont;
use crate::traits::FontView;

/// One unit of text to shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShapeUnit {
    /// A character, mapped to a glyph through the font's Unicode values.
    Character(char),
    /// A glyph inserted by name, such as an alternate with no Unicode value.
    /// It is shaped as itself: features can still substitute or position it,
    /// but it never joins or forms context the way a character would.
    Glyph(GlyphId),
}

/// A run of text and how to shape it.
#[derive(Clone, Copy, Debug)]
pub struct ShapeRequest<'a> {
    pub units: &'a [ShapeUnit],
    /// Where in the designspace to shape, in user coordinates. Axes it omits
    /// are at their default, and values outside an axis are clamped to it.
    pub location: &'a ExternalLocation,
    /// `None` guesses the direction from the script.
    pub direction: Option<TextDirection>,
    /// An ISO 15924 script tag, such as `Arab`; `None` guesses it from the
    /// characters.
    pub script: Option<&'a str>,
    /// A BCP 47 language tag, which selects `locl` and other language
    /// systems; `None` uses the default language system.
    pub language: Option<&'a str>,
    /// Settings over the features the shaper applies by default.
    pub features: &'a [FeatureSetting],
}

/// A paragraph and how to shape it: split into runs of one script, each
/// shaped in that script's direction.
#[derive(Clone, Copy, Debug)]
pub struct ParagraphRequest<'a> {
    pub units: &'a [ShapeUnit],
    /// Where in the designspace to shape, in user coordinates, as in
    /// [`ShapeRequest::location`].
    pub location: &'a ExternalLocation,
    /// An ISO 15924 script tag, such as `Arab`, that every run is shaped in;
    /// `None` shapes each run in the script of its own characters.
    pub script: Option<&'a str>,
    /// A BCP 47 language tag; `None` uses the default language system.
    pub language: Option<&'a str>,
    /// Settings over the features the shaper applies by default, for every run.
    pub features: &'a [FeatureSetting],
}

/// A shaped paragraph: its direction and its runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapedParagraph {
    /// The paragraph's base direction, from its first strong character.
    pub direction: TextDirection,
    /// Runs in logical order; a line lays them out by their levels.
    pub runs: Vec<ShapedRun>,
}

/// One run of a shaped paragraph, in one script and bidi level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapedRun {
    /// The paragraph units the run covers. Runs are in logical order and
    /// together cover every unit.
    pub units: Range<u32>,
    /// The run's ISO 15924 script tag, such as `Arab`; `None` when the run
    /// holds only characters common to all scripts.
    pub script: Option<String>,
    /// The run's resolved bidi level; odd levels read right to left.
    pub level: u8,
    pub direction: TextDirection,
    /// The run's glyphs in visual order. Clusters index the paragraph's units,
    /// not the run's.
    pub glyphs: Vec<ShapedGlyph>,
}

/// One glyph of shaped text.
///
/// Advances and offsets hold only what `GPOS` in the feature source
/// contributes: every glyph's own advance is zero while shaping, so the caller
/// adds live advances, kerning, and mark attachment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapedGlyph {
    /// `None` when a character has no glyph.
    pub glyph_id: Option<GlyphId>,
    /// Index of the first unit this glyph came from. A ligature carries the
    /// cluster of its first component; marks share their base's cluster when
    /// the shaper merges them.
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    /// Whether `GDEF` classes the glyph as a mark: it takes no advance of
    /// its own and cursive attachment passes over it.
    pub is_mark: bool,
}

/// Shapes text with a [`ShaperFont`], taking characters from the live font.
///
/// Runs shift-shape with a [`GlyphSource`] that maps characters through the
/// live font's Unicode values and gives every glyph a zero advance, so
/// results hold only what the feature source contributes. The character
/// mapping is captured when the shaper is made; make a new one after Unicode
/// values change.
pub struct LiveShaper {
    font: Arc<ShaperFont>,
    /// `None` when the shaper font cannot be read.
    shaper: Option<Shaper>,
    characters: LiveCharacters,
    glyphs: HashMap<GlyphId, u32>,
}

impl LiveShaper {
    /// Makes a shaper for `font`, mapping characters through the Unicode
    /// values of `view`'s glyphs. A character two glyphs claim maps to the
    /// first in glyph order.
    pub fn new(font: Arc<ShaperFont>, view: &impl FontView) -> Self {
        let glyphs: HashMap<GlyphId, u32> = font
            .glyph_ids
            .iter()
            .enumerate()
            .filter_map(|(index, glyph_id)| {
                let index = u32::try_from(index).ok()?;
                Some((glyph_id.clone()?, index))
            })
            .collect();

        let mut characters = HashMap::new();
        for glyph in view.glyphs() {
            let Some(&shaper_glyph) = glyphs.get(&glyph.id()) else {
                continue;
            };
            for &codepoint in glyph.unicodes() {
                characters
                    .entry(codepoint)
                    .and_modify(|current: &mut u32| *current = (*current).min(shaper_glyph))
                    .or_insert(shaper_glyph);
            }
        }

        Self {
            shaper: Shaper::new(font.bytes().to_vec()).ok(),
            font,
            characters: LiveCharacters(characters),
            glyphs,
        }
    }

    /// Returns the shaper font this shaper uses.
    pub fn font(&self) -> &Arc<ShaperFont> {
        &self.font
    }

    /// Shapes one run of text.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] when the run is too long to index, inserts more
    /// distinct glyphs by name than there are stand-in characters, or names a
    /// script or language the shaper does not know.
    pub fn shape(&self, request: &ShapeRequest) -> Result<Vec<ShapedGlyph>, ShapeError> {
        let units = self.units(request.units);
        let coords = self.normalized_coords(request.location);
        let glyphs = self.shaper()?.shape(
            &self.characters,
            &shift_shape::ShapeRequest {
                units: &units,
                coords: &coords,
                direction: request.direction,
                script: request.script,
                language: request.language,
                features: request.features,
            },
        )?;
        Ok(glyphs
            .iter()
            .map(|glyph| self.shaped_glyph(glyph))
            .collect())
    }

    /// Shapes a paragraph, run by run.
    ///
    /// The paragraph splits where its script or bidi level changes, and each
    /// run is shaped in its level's direction, so Arabic and Hebrew come back
    /// right to left and digits inside them left to right. Runs stay in
    /// logical order with their levels; reordering them for display is the
    /// line's job.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_paragraph(
        &self,
        request: &ParagraphRequest,
    ) -> Result<ShapedParagraph, ShapeError> {
        let units = self.units(request.units);
        let coords = self.normalized_coords(request.location);
        let paragraph = self.shaper()?.shape_paragraph(
            &self.characters,
            &shift_shape::ParagraphRequest {
                units: &units,
                coords: &coords,
                script: request.script,
                language: request.language,
                features: request.features,
            },
        )?;
        Ok(ShapedParagraph {
            direction: paragraph.direction,
            runs: paragraph
                .runs
                .into_iter()
                .map(|run| ShapedRun {
                    units: run.units,
                    script: run.script,
                    level: run.level,
                    direction: run.direction,
                    glyphs: run
                        .glyphs
                        .iter()
                        .map(|glyph| self.shaped_glyph(glyph))
                        .collect(),
                })
                .collect(),
        })
    }

    /// Returns every substitution a feature can make, ordered by output glyph
    /// then input; see [`Shaper::feature_substitutions`]. Rules whose glyphs
    /// are not Shift glyphs, such as `.notdef`, are left out.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the shaper font's `GSUB`
    /// cannot be read.
    pub fn feature_substitutions(&self, tag: &str) -> Result<Vec<Substitution>, ShapeError> {
        Ok(self
            .shaper()?
            .feature_substitutions(tag)?
            .into_iter()
            .filter_map(|rule| {
                let input = rule
                    .input
                    .into_iter()
                    .map(|glyph| self.glyph_id(glyph))
                    .collect::<Option<Vec<_>>>()?;
                Some(Substitution {
                    input,
                    output: self.glyph_id(rule.output)?,
                })
            })
            .collect())
    }

    fn shaper(&self) -> Result<&Shaper, ShapeError> {
        self.shaper.as_ref().ok_or(ShapeError::InvalidFont)
    }

    /// Converts units to shift-shape's, inserting glyphs by their shaper id;
    /// a glyph the shaper font lacks shapes as `.notdef`.
    fn units(&self, units: &[ShapeUnit]) -> Vec<Unit> {
        units
            .iter()
            .map(|unit| match unit {
                ShapeUnit::Character(character) => Unit::Character(*character),
                ShapeUnit::Glyph(glyph_id) => {
                    Unit::Glyph(self.glyphs.get(glyph_id).copied().unwrap_or(NOTDEF))
                }
            })
            .collect()
    }

    fn shaped_glyph(&self, glyph: &shift_shape::ShapedGlyph) -> ShapedGlyph {
        ShapedGlyph {
            glyph_id: self.glyph_id(glyph.glyph),
            cluster: glyph.cluster,
            x_advance: glyph.x_advance,
            y_advance: glyph.y_advance,
            x_offset: glyph.x_offset,
            y_offset: glyph.y_offset,
            is_mark: glyph.is_mark,
        }
    }

    /// Normalizes `location` on the shaper font's axes, in `fvar` order.
    fn normalized_coords(&self, location: &ExternalLocation) -> Vec<NormalizedCoord> {
        self.font
            .axes
            .iter()
            .zip(&self.font.axis_ids)
            .map(|(axis, axis_id)| {
                let user = location
                    .get(axis_id)
                    .unwrap_or_else(|| axis.default.to_f64())
                    .clamp(axis.min.to_f64(), axis.max.to_f64());
                let normalized = UserCoord::new(user).to_normalized(&axis.converter);
                NormalizedCoord::from_f32(normalized.to_f64() as f32)
            })
            .collect()
    }

    /// Returns the Shift glyph at a shaper glyph id; `None` for `.notdef`.
    fn glyph_id(&self, shaper_glyph: u32) -> Option<GlyphId> {
        if shaper_glyph == NOTDEF {
            return None;
        }
        let index = usize::try_from(shaper_glyph).ok()?;
        self.font.glyph_ids.get(index)?.clone()
    }
}

/// Maps characters through the live font. Every advance is zero: the editor
/// adds live advances itself.
struct LiveCharacters(HashMap<u32, u32>);

impl GlyphSource for LiveCharacters {
    fn glyph(&self, codepoint: u32) -> Option<u32> {
        self.0.get(&codepoint).copied()
    }

    fn advance(&self, _glyph: u32) -> Option<i32> {
        Some(0)
    }
}

/// One substitution a feature can make: `input` in the text becomes `output`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<GlyphId>,
    pub output: GlyphId,
}

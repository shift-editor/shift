use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use fontdrasil::coords::UserCoord;
use harfrust::font::{BuiltinFontFuncs, FontFuncs};
use harfrust::{
    Direction, Feature, FontRef, GlyphId as ShaperGlyphId, Language, NormalizedCoord, Script,
    ShapeOptions, ShaperData, ShaperInstance, Tag, UnicodeBuffer,
};
use shift_font::{ExternalLocation, GlyphId};
use skrifa::raw::tables::layout::ClassDef;
use skrifa::raw::types::GlyphId16;
use skrifa::raw::TableProvider;

use super::itemize::itemize;
use super::ShaperFont;
use crate::traits::FontView;

/// Glyph id of `.notdef`, which a character the font does not map shapes to.
const NOTDEF: ShaperGlyphId = ShaperGlyphId::NOTDEF;

/// The characters that stand in for glyphs inserted by name: Supplementary
/// Private Use Area-B, which fonts rarely map.
const GLYPH_STAND_INS: std::ops::RangeInclusive<u32> = 0x10_0000..=0x10_FFFD;

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

/// The direction a run of text is shaped in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextDirection {
    LeftToRight,
    RightToLeft,
}

/// A feature to turn on, off, or to an alternate for the whole run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeatureSetting {
    pub tag: Tag,
    /// `0` turns the feature off, `1` on; larger values pick an alternate.
    pub value: u32,
}

impl FeatureSetting {
    /// Makes a setting from a four-character feature tag such as `liga`.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFeatureTag`] when `tag` is not one to four
    /// printable ASCII characters.
    pub fn parse(tag: &str, value: u32) -> Result<Self, ShapeError> {
        let invalid = || ShapeError::InvalidFeatureTag(tag.to_string());
        let tag = Tag::new_checked(tag.as_bytes()).map_err(|_| invalid())?;
        Ok(Self { tag, value })
    }
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

/// Describes why a run could not be shaped.
#[derive(Debug, thiserror::Error)]
pub enum ShapeError {
    #[error("the run has more units than a cluster index can hold")]
    TooManyUnits,

    #[error("the run inserts more distinct glyphs by name than can be shaped at once")]
    TooManyInsertedGlyphs,

    #[error("invalid feature tag {0:?}")]
    InvalidFeatureTag(String),

    #[error("unknown script tag {0:?}")]
    UnknownScript(String),

    #[error("invalid language tag {0:?}")]
    InvalidLanguage(String),

    #[error("cannot read the shaper font")]
    InvalidFont,
}

/// Shapes text with a [`ShaperFont`], taking characters from the live font.
///
/// The character mapping is captured when the shaper is made; make a new one
/// after Unicode values change.
pub struct LiveShaper {
    font: Arc<ShaperFont>,
    characters: HashMap<u32, ShaperGlyphId>,
    glyphs: HashMap<GlyphId, ShaperGlyphId>,
}

impl LiveShaper {
    /// Makes a shaper for `font`, mapping characters through the Unicode
    /// values of `view`'s glyphs. A character two glyphs claim maps to the
    /// first in glyph order.
    pub fn new(font: Arc<ShaperFont>, view: &impl FontView) -> Self {
        let glyphs: HashMap<GlyphId, ShaperGlyphId> = font
            .glyph_ids
            .iter()
            .enumerate()
            .filter_map(|(index, glyph_id)| {
                let index = u32::try_from(index).ok()?;
                Some((glyph_id.clone()?, ShaperGlyphId::new(index)))
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
                    .and_modify(|current: &mut ShaperGlyphId| {
                        *current = (*current).min(shaper_glyph);
                    })
                    .or_insert(shaper_glyph);
            }
        }

        Self {
            font,
            characters,
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
        let mut funcs = LiveFontFuncs {
            characters: &self.characters,
            stand_ins: HashMap::new(),
        };
        let buffer = self.buffer(request, &mut funcs)?;
        let features: Vec<Feature> = request
            .features
            .iter()
            .map(|setting| Feature::new(setting.tag, setting.value, ..))
            .collect();

        let binary = FontRef::new(self.font.bytes()).map_err(|_| ShapeError::InvalidFont)?;
        let data = ShaperData::new(&binary);
        let instance =
            ShaperInstance::from_coords(&binary, self.normalized_coords(request.location));
        let shaper = data.shaper(&binary).instance(Some(&instance)).build();
        let shaped = shaper.shape(
            buffer,
            ShapeOptions::new()
                .features(&features)
                .font_funcs(Some(&mut funcs)),
        );

        let mark_classes = skrifa::FontRef::new(self.font.bytes())
            .ok()
            .and_then(|font| font.gdef().ok())
            .and_then(|gdef| gdef.glyph_class_def())
            .and_then(Result::ok);
        Ok(shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| ShapedGlyph {
                glyph_id: self.glyph_id(info.glyph_id),
                cluster: info.cluster,
                x_advance: position.x_advance,
                y_advance: position.y_advance,
                x_offset: position.x_offset,
                y_offset: position.y_offset,
                is_mark: is_mark(mark_classes.as_ref(), info.glyph_id),
            })
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
        let itemized = itemize(request.units);
        let runs = itemized
            .runs
            .into_iter()
            .map(|run| {
                let start = unit_index(run.units.start)?;
                let end = unit_index(run.units.end)?;
                let script = match request.script {
                    Some(script) => Some(script.to_string()),
                    None => run.script.map(|script| script.short_name().to_string()),
                };
                let direction = if run.level % 2 == 1 {
                    TextDirection::RightToLeft
                } else {
                    TextDirection::LeftToRight
                };
                let mut glyphs = self.shape(&ShapeRequest {
                    units: &request.units[run.units],
                    location: request.location,
                    direction: Some(direction),
                    script: script.as_deref(),
                    language: request.language,
                    features: request.features,
                })?;
                for glyph in &mut glyphs {
                    glyph.cluster += start;
                }
                Ok(ShapedRun {
                    units: start..end,
                    script,
                    level: run.level,
                    direction,
                    glyphs,
                })
            })
            .collect::<Result<_, ShapeError>>()?;
        let direction = if itemized.right_to_left {
            TextDirection::RightToLeft
        } else {
            TextDirection::LeftToRight
        };
        Ok(ShapedParagraph { direction, runs })
    }

    /// Fills a buffer with one character per unit, clustered by unit index,
    /// and registers a stand-in character for each inserted glyph.
    fn buffer(
        &self,
        request: &ShapeRequest,
        funcs: &mut LiveFontFuncs,
    ) -> Result<UnicodeBuffer, ShapeError> {
        let mut buffer = UnicodeBuffer::new();
        let mut stand_ins: HashMap<&GlyphId, char> = HashMap::new();
        let mut next_stand_in = GLYPH_STAND_INS.clone();

        for (index, unit) in request.units.iter().enumerate() {
            let cluster = unit_index(index)?;
            let character = match unit {
                ShapeUnit::Character(character) => *character,
                ShapeUnit::Glyph(glyph_id) => match stand_ins.get(glyph_id) {
                    Some(&character) => character,
                    None => {
                        let character = next_stand_in
                            .next()
                            .and_then(char::from_u32)
                            .ok_or(ShapeError::TooManyInsertedGlyphs)?;
                        let glyph = self.glyphs.get(glyph_id).copied().unwrap_or(NOTDEF);
                        funcs.stand_ins.insert(u32::from(character), glyph);
                        stand_ins.insert(glyph_id, character);
                        character
                    }
                },
            };
            buffer.add(character, cluster);
        }

        if let Some(direction) = request.direction {
            buffer.set_direction(match direction {
                TextDirection::LeftToRight => Direction::LeftToRight,
                TextDirection::RightToLeft => Direction::RightToLeft,
            });
        }
        if let Some(script) = request.script {
            buffer.set_script(iso15924_script(script)?);
        }
        if let Some(language) = request.language {
            let language: Language = language
                .parse()
                .map_err(|_| ShapeError::InvalidLanguage(language.to_string()))?;
            buffer.set_language(language);
        }
        buffer.guess_segment_properties();

        Ok(buffer)
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

    /// Returns every substitution a feature can make, ordered by output glyph
    /// then input: each rule of each lookup the feature reaches, lookups that
    /// contextual rules call included, whether or not its input is a glyph the
    /// font maps a character to. A rule with several outputs, such as a
    /// multiple substitution or a set of alternates, gives one substitution
    /// per output.
    ///
    /// Empty for a positioning feature, or a tag the font does not define.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the shaper font's `GSUB`
    /// cannot be read.
    pub fn feature_substitutions(&self, tag: &str) -> Result<Vec<Substitution>, ShapeError> {
        use skrifa::raw::collections::IntSet;
        use skrifa::raw::tables::gsub::{SingleSubst, SubstitutionSubtables};
        use skrifa::raw::types::GlyphId as RawGlyphId;

        let invalid = |_| ShapeError::InvalidFont;
        let font = skrifa::raw::FontRef::new(self.font.bytes()).map_err(invalid)?;
        let Ok(gsub) = font.gsub() else {
            return Ok(Vec::new());
        };
        let mut features = IntSet::<u16>::empty();
        for (index, record) in gsub
            .feature_list()
            .map_err(invalid)?
            .feature_records()
            .iter()
            .enumerate()
        {
            if record.feature_tag() == tag {
                features.insert(u16::try_from(index).map_err(|_| ShapeError::InvalidFont)?);
            }
        }
        if features.is_empty() {
            return Ok(Vec::new());
        }
        let lookup_list = gsub.lookup_list().map_err(invalid)?;
        let mut lookups = gsub.collect_lookups(&features).map_err(invalid)?;
        let mut every_glyph = IntSet::<RawGlyphId>::empty();
        every_glyph.invert();
        lookup_list
            .closure_lookups(&every_glyph, &mut lookups)
            .map_err(invalid)?;

        // Shaper glyph ids: (output, input sequence).
        let mut rules = std::collections::BTreeSet::<(u32, Vec<u32>)>::new();
        let mut add = |input: Vec<u32>, output: u32| {
            rules.insert((output, input));
        };
        for index in lookups.iter() {
            let lookup = lookup_list
                .lookups()
                .get(usize::from(index))
                .map_err(invalid)?;
            match lookup.subtables().map_err(invalid)? {
                SubstitutionSubtables::Single(subtables) => {
                    for subtable in subtables.iter() {
                        match subtable.map_err(invalid)? {
                            SingleSubst::Format1(table) => {
                                let delta = i32::from(table.delta_glyph_id());
                                for glyph in table.coverage().map_err(invalid)?.iter() {
                                    // The delta wraps modulo 65536.
                                    let output =
                                        (i32::from(glyph.to_u16()) + delta).rem_euclid(1 << 16);
                                    add(vec![glyph.to_u32()], output.unsigned_abs());
                                }
                            }
                            SingleSubst::Format2(table) => {
                                let coverage = table.coverage().map_err(invalid)?;
                                for (glyph, output) in
                                    coverage.iter().zip(table.substitute_glyph_ids())
                                {
                                    add(vec![glyph.to_u32()], output.get().to_u32());
                                }
                            }
                        }
                    }
                }
                SubstitutionSubtables::Multiple(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, sequence) in coverage.iter().zip(subtable.sequences().iter()) {
                            for output in sequence.map_err(invalid)?.substitute_glyph_ids() {
                                add(vec![glyph.to_u32()], output.get().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Alternate(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, set) in coverage.iter().zip(subtable.alternate_sets().iter()) {
                            for output in set.map_err(invalid)?.alternate_glyph_ids() {
                                add(vec![glyph.to_u32()], output.get().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Ligature(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (first, set) in coverage.iter().zip(subtable.ligature_sets().iter()) {
                            for ligature in set.map_err(invalid)?.ligatures().iter() {
                                let ligature = ligature.map_err(invalid)?;
                                let mut input = vec![first.to_u32()];
                                input.extend(
                                    ligature
                                        .component_glyph_ids()
                                        .iter()
                                        .map(|id| id.get().to_u32()),
                                );
                                add(input, ligature.ligature_glyph().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Reverse(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, output) in coverage.iter().zip(subtable.substitute_glyph_ids())
                        {
                            add(vec![glyph.to_u32()], output.get().to_u32());
                        }
                    }
                }
                // Contextual rules substitute only through the lookups they
                // call, which the closure above already added.
                SubstitutionSubtables::Contextual(_)
                | SubstitutionSubtables::ChainContextual(_) => {}
            }
        }
        Ok(rules
            .into_iter()
            .filter_map(|(output, input)| {
                let input = input
                    .into_iter()
                    .map(|glyph| self.glyph_id(glyph))
                    .collect::<Option<Vec<_>>>()?;
                Some(Substitution {
                    input,
                    output: self.glyph_id(output)?,
                })
            })
            .collect())
    }

    /// Returns the Shift glyph at a shaper glyph id; `None` for `.notdef`.
    fn glyph_id(&self, shaper_glyph: u32) -> Option<GlyphId> {
        if shaper_glyph == NOTDEF.to_u32() {
            return None;
        }
        let index = usize::try_from(shaper_glyph).ok()?;
        self.font.glyph_ids.get(index)?.clone()
    }
}

/// Converts a unit index to the `u32` a cluster holds.
///
/// # Errors
///
/// Returns [`ShapeError::TooManyUnits`] when the index does not fit.
fn unit_index(index: usize) -> Result<u32, ShapeError> {
    u32::try_from(index).map_err(|_| ShapeError::TooManyUnits)
}

fn iso15924_script(tag: &str) -> Result<Script, ShapeError> {
    Tag::new_checked(tag.as_bytes())
        .ok()
        .and_then(Script::from_iso15924_tag)
        .ok_or_else(|| ShapeError::UnknownScript(tag.to_string()))
}

/// Maps characters through the live font, and stand-ins to their inserted
/// glyphs. Every advance is zero.
struct LiveFontFuncs<'a> {
    characters: &'a HashMap<u32, ShaperGlyphId>,
    stand_ins: HashMap<u32, ShaperGlyphId>,
}

impl FontFuncs for LiveFontFuncs<'_> {
    fn nominal_glyph(&mut self, _builtin: &BuiltinFontFuncs, c: u32) -> Option<ShaperGlyphId> {
        self.stand_ins
            .get(&c)
            .or_else(|| self.characters.get(&c))
            .copied()
    }

    fn advance_width(&mut self, _builtin: &BuiltinFontFuncs, _glyph: ShaperGlyphId) -> i32 {
        0
    }
}

/// Returns whether `classes`, a `GDEF` glyph class table, puts `glyph` in the
/// mark class.
fn is_mark(classes: Option<&ClassDef<'_>>, glyph: u32) -> bool {
    const MARK_CLASS: u16 = 3;
    let Some(classes) = classes else { return false };
    u16::try_from(glyph).is_ok_and(|glyph| classes.get(GlyphId16::new(glyph)) == MARK_CLASS)
}

/// One substitution a feature can make: `input` in the text becomes `output`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<GlyphId>,
    pub output: GlyphId,
}

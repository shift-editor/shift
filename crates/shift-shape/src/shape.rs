use std::collections::{BTreeSet, HashMap};

use std::ops::Range;

use harfrust::font::{BuiltinFontFuncs, FontFuncs};
use harfrust::{
    Direction, Feature, FontRef, GlyphId, Language, NormalizedCoord, Script, ShapeOptions,
    ShaperData, ShaperInstance, Tag, UnicodeBuffer,
};
use skrifa::raw::tables::layout::ClassDef;
use skrifa::raw::types::GlyphId16;
use skrifa::raw::TableProvider;

use crate::itemize::itemize;
use crate::Unit;

/// Shaper glyph id of `.notdef`, which a character the font does not map
/// shapes to.
pub const NOTDEF: u32 = 0;

/// The characters that stand in for glyphs inserted by name: Supplementary
/// Private Use Area-B, which fonts rarely map.
const GLYPH_STAND_INS: std::ops::RangeInclusive<u32> = 0x10_0000..=0x10_FFFD;

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

/// Where a shaper's characters map to glyphs, and what a glyph's own advance
/// is. `None` from either defers to the shaping font's own `cmap` or `hmtx`.
pub trait GlyphSource {
    /// Returns the shaper glyph a character maps to.
    fn glyph(&self, codepoint: u32) -> Option<u32> {
        let _ = codepoint;
        None
    }

    /// Returns a glyph's own advance, in font units.
    fn advance(&self, glyph: u32) -> Option<i32> {
        let _ = glyph;
        None
    }
}

/// A compiled font's own character mapping and advances.
impl GlyphSource for () {}

/// A run of text and how to shape it.
#[derive(Clone, Copy, Debug)]
pub struct ShapeRequest<'a> {
    pub units: &'a [Unit],
    /// Normalized coordinates on the shaping font's axes, in `fvar` order.
    pub coords: &'a [NormalizedCoord],
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

/// A paragraph and how to shape it: split into runs of one script and bidi
/// level, each shaped in its level's direction.
#[derive(Clone, Copy, Debug)]
pub struct ParagraphRequest<'a> {
    pub units: &'a [Unit],
    /// Normalized coordinates, as in [`ShapeRequest::coords`].
    pub coords: &'a [NormalizedCoord],
    /// An ISO 15924 script tag that every run is shaped in; `None` shapes
    /// each run in the script of its own characters.
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

/// One glyph of shaped text, in font units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShapedGlyph {
    /// The shaper glyph id; [`NOTDEF`] when a character has no glyph.
    pub glyph: u32,
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

    #[error("cannot read the shaping font")]
    InvalidFont,
}

/// Shapes text with one font's compiled features.
///
/// Parses the font's layout tables once, when made, rather than for every
/// run: keep a shaper for as long as its font bytes do not change.
pub struct Shaper {
    bytes: Vec<u8>,
    data: ShaperData,
    marks: BTreeSet<u32>,
}

impl Shaper {
    /// Makes a shaper for a font's bytes: a whole compiled font, or a shaper
    /// font holding only layout tables.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when `bytes` is not a font.
    pub fn new(bytes: Vec<u8>) -> Result<Self, ShapeError> {
        let font = FontRef::new(&bytes).map_err(|_| ShapeError::InvalidFont)?;
        let data = ShaperData::new(&font);
        let marks = mark_glyphs(&bytes);
        Ok(Self { bytes, data, marks })
    }

    /// Returns the font bytes this shaper shapes with.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Shapes one run of text.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] when the run is too long to index, inserts more
    /// distinct glyphs by name than there are stand-in characters, or names a
    /// script or language the shaper does not know.
    pub fn shape(
        &self,
        source: &impl GlyphSource,
        request: &ShapeRequest,
    ) -> Result<Vec<ShapedGlyph>, ShapeError> {
        let mut funcs = SourceFuncs {
            source,
            stand_ins: HashMap::new(),
        };
        let buffer = buffer(request, &mut funcs)?;
        let features: Vec<Feature> = request
            .features
            .iter()
            .map(|setting| Feature::new(setting.tag, setting.value, ..))
            .collect();

        let font = FontRef::new(&self.bytes).map_err(|_| ShapeError::InvalidFont)?;
        let instance = ShaperInstance::from_coords(&font, request.coords.iter().copied());
        let shaper = self.data.shaper(&font).instance(Some(&instance)).build();
        let shaped = shaper.shape(
            buffer,
            ShapeOptions::new()
                .features(&features)
                .font_funcs(Some(&mut funcs)),
        );

        Ok(shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| ShapedGlyph {
                glyph: info.glyph_id,
                cluster: info.cluster,
                x_advance: position.x_advance,
                y_advance: position.y_advance,
                x_offset: position.x_offset,
                y_offset: position.y_offset,
                is_mark: self.marks.contains(&info.glyph_id),
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
        source: &impl GlyphSource,
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
                let direction = direction_of(run.level);
                let mut glyphs = self.shape(
                    source,
                    &ShapeRequest {
                        units: &request.units[run.units],
                        coords: request.coords,
                        direction: Some(direction),
                        script: script.as_deref(),
                        language: request.language,
                        features: request.features,
                    },
                )?;
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
}

impl Shaper {
    /// Returns every substitution a feature can make, ordered by output glyph
    /// then input: each rule of each lookup the feature reaches, lookups that
    /// contextual rules call included, whether or not its input is a glyph the
    /// font maps a character to. A rule with several outputs, such as a
    /// multiple substitution or a set of alternates, gives one substitution
    /// per output.
    ///
    /// Glyphs are shaper glyph ids. Empty for a positioning feature, or a tag
    /// the font does not define.
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
        let font = skrifa::raw::FontRef::new(&self.bytes).map_err(invalid)?;
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
            .map(|(output, input)| Substitution { input, output })
            .collect())
    }
}

/// One substitution a feature can make: `input` in the text becomes `output`,
/// as shaper glyph ids.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<u32>,
    pub output: u32,
}

fn direction_of(level: u8) -> TextDirection {
    if level % 2 == 1 {
        TextDirection::RightToLeft
    } else {
        TextDirection::LeftToRight
    }
}

/// Fills a buffer with one character per unit, clustered by unit index, and
/// registers a stand-in character for each inserted glyph.
fn buffer(
    request: &ShapeRequest,
    funcs: &mut SourceFuncs<'_, impl GlyphSource>,
) -> Result<UnicodeBuffer, ShapeError> {
    let mut buffer = UnicodeBuffer::new();
    let mut stand_ins: HashMap<u32, char> = HashMap::new();
    let mut next_stand_in = GLYPH_STAND_INS.clone();

    for (index, unit) in request.units.iter().enumerate() {
        let cluster = unit_index(index)?;
        let character = match *unit {
            Unit::Character(character) => character,
            Unit::Glyph(glyph) => match stand_ins.get(&glyph) {
                Some(&character) => character,
                None => {
                    let character = next_stand_in
                        .next()
                        .and_then(char::from_u32)
                        .ok_or(ShapeError::TooManyInsertedGlyphs)?;
                    funcs
                        .stand_ins
                        .insert(u32::from(character), GlyphId::new(glyph));
                    stand_ins.insert(glyph, character);
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

/// Converts a unit index to the `u32` a cluster holds.
///
/// # Errors
///
/// Returns [`ShapeError::TooManyUnits`] when the index does not fit.
pub(crate) fn unit_index(index: usize) -> Result<u32, ShapeError> {
    u32::try_from(index).map_err(|_| ShapeError::TooManyUnits)
}

fn iso15924_script(tag: &str) -> Result<Script, ShapeError> {
    Tag::new_checked(tag.as_bytes())
        .ok()
        .and_then(Script::from_iso15924_tag)
        .ok_or_else(|| ShapeError::UnknownScript(tag.to_string()))
}

/// Maps stand-ins to their inserted glyphs, and asks the source for the rest,
/// falling back to the font's own tables.
struct SourceFuncs<'a, S> {
    source: &'a S,
    stand_ins: HashMap<u32, GlyphId>,
}

impl<S: GlyphSource> FontFuncs for SourceFuncs<'_, S> {
    fn nominal_glyph(&mut self, builtin: &BuiltinFontFuncs, c: u32) -> Option<GlyphId> {
        if let Some(&glyph) = self.stand_ins.get(&c) {
            return Some(glyph);
        }
        match self.source.glyph(c) {
            Some(glyph) => Some(GlyphId::new(glyph)),
            None => builtin.nominal_glyph(c),
        }
    }

    fn advance_width(&mut self, builtin: &BuiltinFontFuncs, glyph: GlyphId) -> i32 {
        self.source
            .advance(glyph.to_u32())
            .unwrap_or_else(|| builtin.advance_width(glyph))
    }
}

/// The glyphs `GDEF` classes as marks.
fn mark_glyphs(bytes: &[u8]) -> BTreeSet<u32> {
    const MARK_CLASS: u16 = 3;
    let Some(classes) = skrifa::FontRef::new(bytes)
        .ok()
        .and_then(|font| font.gdef().ok())
        .and_then(|gdef| gdef.glyph_class_def())
        .and_then(Result::ok)
    else {
        return BTreeSet::new();
    };
    marks_in(&classes, MARK_CLASS)
}

fn marks_in(classes: &ClassDef<'_>, mark_class: u16) -> BTreeSet<u32> {
    classes
        .iter()
        .filter(|&(_, class)| class == mark_class)
        .map(|(glyph, _): (GlyphId16, u16)| glyph.to_u32())
        .collect()
}

use std::collections::HashMap;
use std::ops::Range;

use harfrust::font::{BuiltinFontFuncs, FontFuncs};
use harfrust::{
    Direction, Feature, FontRef, GlyphId, Language, NormalizedCoord, Script, ShapeOptions,
    ShaperData, ShaperInstance, Tag, UnicodeBuffer,
};

use crate::itemize::script_runs;
use crate::{GlyphSource, NOTDEF, Unit};

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
        let tag = Tag::new_checked(tag.as_bytes())
            .map_err(|_| ShapeError::InvalidFeatureTag(tag.to_string()))?;
        Ok(Self { tag, value })
    }
}

/// A run of text and how to shape it.
///
/// `G` names inserted glyphs, as the host's [`GlyphSource::Glyph`]. `L` is the
/// location: a [`Shaper`] takes normalized coordinates on the shaping font's
/// axes, in `fvar` order, and a host holding another kind of location
/// converts it with [`Self::at`].
#[derive(Debug)]
pub struct ShapeRequest<'a, G, L: ?Sized = [NormalizedCoord]> {
    pub units: &'a [Unit<G>],
    pub location: &'a L,
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

impl<'a, G, L: ?Sized> ShapeRequest<'a, G, L> {
    /// Returns the same request at another location.
    pub fn at<'b, M: ?Sized>(&self, location: &'b M) -> ShapeRequest<'b, G, M>
    where
        'a: 'b,
    {
        ShapeRequest {
            units: self.units,
            location,
            direction: self.direction,
            script: self.script,
            language: self.language,
            features: self.features,
        }
    }
}

impl<G, L: ?Sized> Clone for ShapeRequest<'_, G, L> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<G, L: ?Sized> Copy for ShapeRequest<'_, G, L> {}

/// A paragraph and how to shape it: split into runs of one script, each
/// shaped in that script's direction. `G` and `L` are as in [`ShapeRequest`].
#[derive(Debug)]
pub struct ParagraphRequest<'a, G, L: ?Sized = [NormalizedCoord]> {
    pub units: &'a [Unit<G>],
    pub location: &'a L,
    /// A BCP 47 language tag; `None` uses the default language system.
    pub language: Option<&'a str>,
    /// Settings over the features the shaper applies by default, for every run.
    pub features: &'a [FeatureSetting],
}

impl<'a, G, L: ?Sized> ParagraphRequest<'a, G, L> {
    /// Returns the same request at another location.
    pub fn at<'b, M: ?Sized>(&self, location: &'b M) -> ParagraphRequest<'b, G, M>
    where
        'a: 'b,
    {
        ParagraphRequest {
            units: self.units,
            location,
            language: self.language,
            features: self.features,
        }
    }

    /// Returns the request for one run of the paragraph.
    fn run(&self, units: &'a [Unit<G>], script: Option<&'a str>) -> ShapeRequest<'a, G, L> {
        ShapeRequest {
            units,
            location: self.location,
            direction: None,
            script,
            language: self.language,
            features: self.features,
        }
    }
}

impl<G, L: ?Sized> Clone for ParagraphRequest<'_, G, L> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<G, L: ?Sized> Copy for ParagraphRequest<'_, G, L> {}

/// One run of a shaped paragraph, in one script and direction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapedRun<G> {
    /// The paragraph units the run covers. Runs are in logical order and
    /// together cover every unit.
    pub units: Range<u32>,
    /// The run's ISO 15924 script tag, such as `Arab`; `None` when the run
    /// holds only characters common to all scripts.
    pub script: Option<String>,
    pub direction: TextDirection,
    /// The run's glyphs in visual order. Clusters index the paragraph's units,
    /// not the run's.
    pub glyphs: Vec<ShapedGlyph<G>>,
}

/// One glyph of shaped text, in font units.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShapedGlyph<G> {
    /// `None` when a character has no glyph.
    pub glyph_id: Option<G>,
    /// Index of the first unit this glyph came from. A ligature carries the
    /// cluster of its first component; marks share their base's cluster when
    /// the shaper merges them.
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
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
/// Parses the font's layout tables once, when made,
/// rather than for every run: keep a shaper for as long as its font bytes do
/// not change.
pub struct Shaper {
    bytes: Vec<u8>,
    data: ShaperData,
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
        Ok(Self { bytes, data })
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
    pub fn shape<S: GlyphSource>(
        &self,
        source: &S,
        request: &ShapeRequest<S::Glyph>,
    ) -> Result<Vec<ShapedGlyph<S::Glyph>>, ShapeError> {
        Ok(self.shape_run(source, request)?.glyphs)
    }

    /// Shapes a paragraph, run by run.
    ///
    /// The paragraph splits where its script changes, and each run is shaped
    /// in its script's direction, so Arabic and Hebrew come back right to
    /// left. Runs stay in logical order.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError`] for the reasons [`Self::shape`] gives.
    pub fn shape_paragraph<S: GlyphSource>(
        &self,
        source: &S,
        request: &ParagraphRequest<S::Glyph>,
    ) -> Result<Vec<ShapedRun<S::Glyph>>, ShapeError> {
        script_runs(request.units)
            .into_iter()
            .map(|run| {
                let start = unit_index(run.units.start)?;
                let end = unit_index(run.units.end)?;
                let script = run.script.map(|script| script.short_name().to_string());
                let units = &request.units[run.units];
                let RunGlyphs {
                    mut glyphs,
                    direction,
                } = self.shape_run(source, &request.run(units, script.as_deref()))?;
                for glyph in &mut glyphs {
                    glyph.cluster += start;
                }
                Ok(ShapedRun {
                    units: start..end,
                    script,
                    direction,
                    glyphs,
                })
            })
            .collect()
    }

    /// Shapes one run and reports the direction it was shaped in.
    fn shape_run<S: GlyphSource>(
        &self,
        source: &S,
        request: &ShapeRequest<S::Glyph>,
    ) -> Result<RunGlyphs<S::Glyph>, ShapeError> {
        let mut funcs = SourceFuncs {
            source,
            stand_ins: HashMap::new(),
            stand_in_of: HashMap::new(),
        };
        let buffer = buffer(request, &mut funcs)?;
        let direction = match buffer.direction() {
            Direction::RightToLeft => TextDirection::RightToLeft,
            _ => TextDirection::LeftToRight,
        };
        let features: Vec<Feature> = request
            .features
            .iter()
            .map(|setting| Feature::new(setting.tag, setting.value, ..))
            .collect();

        let font = self.font()?;
        let instance = ShaperInstance::from_coords(&font, request.location.iter().copied());
        let shaper = self.data.shaper(&font).instance(Some(&instance)).build();
        let shaped = shaper.shape(
            buffer,
            ShapeOptions::new()
                .features(&features)
                .font_funcs(Some(&mut funcs)),
        );

        let glyphs = shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| ShapedGlyph {
                glyph_id: source.host_glyph(info.glyph_id),
                cluster: info.cluster,
                x_advance: position.x_advance,
                y_advance: position.y_advance,
                x_offset: position.x_offset,
                y_offset: position.y_offset,
            })
            .collect();
        Ok(RunGlyphs { glyphs, direction })
    }

    fn font(&self) -> Result<FontRef<'_>, ShapeError> {
        FontRef::new(&self.bytes).map_err(|_| ShapeError::InvalidFont)
    }
}

/// A shaped run's glyphs and the direction it was shaped in.
struct RunGlyphs<G> {
    glyphs: Vec<ShapedGlyph<G>>,
    direction: TextDirection,
}

/// Fills a buffer with one character per unit, clustered by unit index, and
/// registers a stand-in character for each inserted glyph.
fn buffer<S: GlyphSource>(
    request: &ShapeRequest<S::Glyph>,
    funcs: &mut SourceFuncs<'_, S>,
) -> Result<UnicodeBuffer, ShapeError> {
    let mut buffer = UnicodeBuffer::new();
    let mut next_stand_in = GLYPH_STAND_INS.clone();

    for (index, unit) in request.units.iter().enumerate() {
        let character = match unit {
            Unit::Character(character) => *character,
            Unit::Glyph(glyph) => {
                let shaper_glyph = funcs.source.shaper_glyph(glyph).unwrap_or(NOTDEF);
                funcs.stand_in(shaper_glyph, &mut next_stand_in)?
            }
        };
        buffer.add(character, unit_index(index)?);
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
fn unit_index(index: usize) -> Result<u32, ShapeError> {
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
    /// Stand-in character to inserted glyph, as shaper glyph ids.
    stand_ins: HashMap<u32, u32>,
    /// Inserted glyph to its stand-in character.
    stand_in_of: HashMap<u32, char>,
}

impl<S> SourceFuncs<'_, S> {
    /// Returns the stand-in character for an inserted glyph, taking the next
    /// free one the first time the glyph is inserted.
    fn stand_in(
        &mut self,
        shaper_glyph: u32,
        next: &mut impl Iterator<Item = u32>,
    ) -> Result<char, ShapeError> {
        if let Some(&character) = self.stand_in_of.get(&shaper_glyph) {
            return Ok(character);
        }
        let character = next
            .next()
            .and_then(char::from_u32)
            .ok_or(ShapeError::TooManyInsertedGlyphs)?;
        self.stand_ins.insert(u32::from(character), shaper_glyph);
        self.stand_in_of.insert(shaper_glyph, character);
        Ok(character)
    }
}

impl<S: GlyphSource> FontFuncs for SourceFuncs<'_, S> {
    fn nominal_glyph(&mut self, builtin: &BuiltinFontFuncs, c: u32) -> Option<GlyphId> {
        if let Some(&glyph) = self.stand_ins.get(&c) {
            return Some(GlyphId::new(glyph));
        }
        match self.source.character_glyph(c) {
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

//! Chooses, shapes, and outlines the short specimen shown on a recent file's
//! thumbnail.
//!
//! The specimen is picked from the compiled font alone, never from its sample
//! text (`name` ID 19): a symbol font shows its first drawn glyphs, a font
//! whose design languages (`meta` `dlng`) are all non-Latin shows a pair from
//! that script, any other font that draws `Ag` shows `Ag`, a font
//! covering another script shows a pair from that script, and a font with one
//! Latin case shows `AG` or `ag`.
//! Text is shaped with HarfRust at the font's
//! default location, and a candidate only counts as covered when shaping
//! draws ink for every cluster, so a mapped but empty glyph that the font
//! decomposes through GSUB still qualifies.
//!
//! Outlines are returned in font units with the y axis pointing down, ready to
//! use as SVG path data.

use std::collections::HashMap;
use std::fmt::Write as _;

use harfrust::{ShapeOptions, ShaperData, UnicodeBuffer};
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::types::Tag;
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider};
use unicode_script::{Script, UnicodeScript};

/// Letters of a non-Latin script a font must cover before that script is
/// treated as its main script.
const MAIN_SCRIPT_LETTERS: usize = 20;
/// Smallest viewport height, in ems, so short marks are not blown up to fill
/// the thumbnail.
const MIN_VIEW_HEIGHT_EM: f64 = 0.6;
/// Space kept around the ink, in ems.
const PADDING_EM: f64 = 0.04;

/// Specimen text and its outline, fitted to the ink.
#[derive(Clone, Debug, PartialEq)]
pub struct Specimen {
    /// Characters shaped for the specimen; empty when glyphs were placed by
    /// glyph order because no characters describe them.
    pub text: String,
    /// SVG path data in font units, y down.
    pub outline: String,
    /// Viewport around the ink in the same units as [`Self::outline`],
    /// padded and enlarged to at least a minimum height.
    pub view_box: ViewBox,
    /// Whether the text runs right to left; a thumbnail wider than the
    /// specimen aligns it to the right edge.
    pub right_to_left: bool,
}

/// Rectangle in SVG viewport coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Builds the thumbnail specimen for a compiled TrueType or OpenType font.
///
/// Returns `None` when the bytes are not a readable font or when no rule
/// finds glyphs with ink; callers show an empty thumbnail in that case.
pub fn specimen(font_data: &[u8]) -> Option<Specimen> {
    let font = SpecimenFont::new(font_data)?;
    let coverage = Coverage::from_characters(font.characters());
    specimen_from(&font, &coverage)
}

/// Builds the specimen from a compiled subset of a font, deciding with the
/// full font's character map.
///
/// `font_data` must include the glyphs for every character in
/// [`subset_plan`]'s result, plus the first glyphs with outlines in glyph
/// order; `characters` is every character the whole font maps.
pub fn specimen_with_characters(font_data: &[u8], characters: &[char]) -> Option<Specimen> {
    let font = SpecimenFont::new(font_data)?;
    let coverage = Coverage::from_characters(characters.iter().copied());
    specimen_from(&font, &coverage)
}

/// What a font source must compile so [`specimen_with_characters`] can draw
/// its specimen without compiling every glyph.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubsetPlan {
    /// Characters any specimen rule might shape; compile their glyphs.
    pub characters: Vec<char>,
    /// Whether the chosen script needs contextual shaping features, so the
    /// whole font must be compiled with its feature code.
    pub needs_features: bool,
}

/// Plans the smallest compile that still draws the right specimen.
///
/// Only the glyph-independent rules are applied here: the specimen text is
/// still chosen after shaping the compiled subset.
pub fn subset_plan(characters: &[char]) -> SubsetPlan {
    let coverage = Coverage::from_characters(characters.iter().copied());
    if coverage.is_symbol_font() {
        return SubsetPlan {
            characters: Vec::new(),
            needs_features: false,
        };
    }

    let covered = |character: &char| characters.contains(character);
    let mut planned: Vec<char> = ['A', 'g', 'G', 'a'].into_iter().filter(covered).collect();
    let draws_ag = covered(&'A') && covered(&'g');
    let script = coverage.main_script();
    if let Some(script) = script {
        planned.extend(script.pair().chars().filter(covered));
        planned.extend(
            coverage
                .letters(script)
                .into_iter()
                .take(SCRIPT_FALLBACK_LETTERS),
        );
    }
    planned.sort_unstable();
    planned.dedup();

    SubsetPlan {
        characters: planned,
        needs_features: !draws_ag && script.is_some_and(SpecimenScript::needs_contextual_forms),
    }
}

fn specimen_from(font: &SpecimenFont, coverage: &Coverage) -> Option<Specimen> {
    if coverage.is_symbol_font() {
        return font.glyph_order_specimen();
    }
    if let Some(script) = font.declared_script() {
        if let Some(specimen) = font.script_specimen(script, coverage) {
            return Some(specimen);
        }
    }
    if let Some(specimen) = font.shaped_specimen("Ag") {
        return Some(specimen);
    }
    if let Some(script) = coverage.main_script() {
        if let Some(specimen) = font.script_specimen(script, coverage) {
            return Some(specimen);
        }
    }

    ["AG", "ag"]
        .into_iter()
        .find_map(|text| font.shaped_specimen(text))
        .or_else(|| font.glyph_order_specimen())
}

/// Letters of the main script kept in a subset for the "first two drawn
/// letters" fallback when the script's pair is not drawn.
const SCRIPT_FALLBACK_LETTERS: usize = 8;

/// A script whose fonts get a script-specific specimen pair.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SpecimenScript {
    Arabic,
    Hebrew,
    Devanagari,
    Japanese,
    Chinese,
    Korean,
    Greek,
    Cyrillic,
    Thai,
}

impl SpecimenScript {
    /// Checked in this order; the first script the font covers wins.
    const ALL: [SpecimenScript; 9] = [
        Self::Arabic,
        Self::Hebrew,
        Self::Devanagari,
        Self::Japanese,
        Self::Chinese,
        Self::Korean,
        Self::Greek,
        Self::Cyrillic,
        Self::Thai,
    ];

    fn pair(self) -> &'static str {
        match self {
            Self::Arabic => "حب",
            Self::Hebrew => "אב",
            Self::Devanagari => "अक",
            Self::Japanese => "永あ",
            Self::Chinese => "永",
            Self::Korean => "한",
            Self::Greek => "Αγ",
            Self::Cyrillic => "Жя",
            Self::Thai => "กข",
        }
    }

    /// Resolves the script a `dlng` ScriptLangTag is written in, from its
    /// script subtag (`fa-Arab`, `Hant`) or else its language (`ko`, `th`).
    ///
    /// Returns [`DeclaredScript::Other`] for Latin, and for languages and
    /// scripts without a specimen pair.
    fn from_language_tag(tag: &str) -> DeclaredScript {
        let subtags: Vec<String> = tag.split('-').map(str::to_ascii_lowercase).collect();
        let script_subtag = subtags
            .iter()
            .find(|subtag| subtag.len() == 4 && subtag.chars().all(|c| c.is_ascii_alphabetic()));
        let script = match script_subtag {
            Some(script) => Self::from_script_subtag(script),
            None => subtags
                .first()
                .and_then(|language| Self::from_language(language)),
        };
        script.map_or(DeclaredScript::Other, DeclaredScript::Specimen)
    }

    fn from_script_subtag(subtag: &str) -> Option<Self> {
        match subtag {
            "arab" => Some(Self::Arabic),
            "hebr" => Some(Self::Hebrew),
            "deva" => Some(Self::Devanagari),
            "jpan" | "hira" | "kana" | "hrkt" => Some(Self::Japanese),
            "hani" | "hans" | "hant" => Some(Self::Chinese),
            "kore" | "hang" => Some(Self::Korean),
            "grek" => Some(Self::Greek),
            "cyrl" => Some(Self::Cyrillic),
            "thai" => Some(Self::Thai),
            _ => None,
        }
    }

    fn from_language(language: &str) -> Option<Self> {
        match language {
            "ar" | "fa" | "ur" | "ps" | "ug" | "ckb" | "sd" => Some(Self::Arabic),
            "he" | "yi" => Some(Self::Hebrew),
            "hi" | "mr" | "ne" | "sa" | "mai" | "bho" => Some(Self::Devanagari),
            "ja" => Some(Self::Japanese),
            "zh" | "yue" => Some(Self::Chinese),
            "ko" => Some(Self::Korean),
            "el" => Some(Self::Greek),
            "ru" | "uk" | "be" | "bg" | "mk" | "sr" | "kk" | "ky" | "tg" | "mn" => {
                Some(Self::Cyrillic)
            }
            "th" => Some(Self::Thai),
            _ => None,
        }
    }

    /// Whether the pair only renders correctly with GSUB contextual forms.
    fn needs_contextual_forms(self) -> bool {
        self == Self::Arabic
    }

    fn includes(self, script: Script) -> bool {
        match self {
            Self::Arabic => script == Script::Arabic,
            Self::Hebrew => script == Script::Hebrew,
            Self::Devanagari => script == Script::Devanagari,
            Self::Japanese => matches!(script, Script::Hiragana | Script::Katakana),
            Self::Chinese => script == Script::Han,
            Self::Korean => script == Script::Hangul,
            Self::Greek => script == Script::Greek,
            Self::Cyrillic => script == Script::Cyrillic,
            Self::Thai => script == Script::Thai,
        }
    }
}

/// Script of one declared design language.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeclaredScript {
    Specimen(SpecimenScript),
    /// Latin, or a script without a specimen pair.
    Other,
}

/// Character coverage read from the font's character map.
struct Coverage {
    characters: usize,
    symbols: usize,
    letters_by_script: HashMap<Script, Vec<char>>,
}

impl Coverage {
    fn from_characters(characters: impl IntoIterator<Item = char>) -> Self {
        let mut coverage = Coverage {
            characters: 0,
            symbols: 0,
            letters_by_script: HashMap::new(),
        };

        for character in characters {
            if character.is_whitespace() || character.is_control() {
                continue;
            }
            coverage.characters += 1;

            if !character.is_alphabetic() {
                if !character.is_numeric() {
                    coverage.symbols += 1;
                }
                continue;
            }

            let script = character.script();
            coverage
                .letters_by_script
                .entry(script)
                .or_default()
                .push(character);
        }

        for letters in coverage.letters_by_script.values_mut() {
            letters.sort_unstable();
        }
        coverage
    }

    fn is_symbol_font(&self) -> bool {
        self.characters > 0 && self.symbols * 2 > self.characters
    }

    fn main_script(&self) -> Option<SpecimenScript> {
        SpecimenScript::ALL
            .into_iter()
            .find(|script| self.letters(*script).len() >= MAIN_SCRIPT_LETTERS)
    }

    fn letters(&self, script: SpecimenScript) -> Vec<char> {
        let mut letters: Vec<char> = self
            .letters_by_script
            .iter()
            .filter(|(candidate, _)| script.includes(**candidate))
            .flat_map(|(_, letters)| letters.iter().copied())
            .collect();
        letters.sort_unstable();
        letters
    }
}

/// One glyph placed on the specimen line, in font units.
struct PlacedGlyph {
    glyph_id: u32,
    x: f64,
    y: f64,
}

struct SpecimenFont<'a> {
    data: &'a [u8],
    font: FontRef<'a>,
    units_per_em: f64,
}

impl<'a> SpecimenFont<'a> {
    fn new(data: &'a [u8]) -> Option<Self> {
        let font = FontRef::new(data).ok()?;
        let units_per_em = f64::from(font.head().ok()?.units_per_em());
        Some(Self {
            data,
            font,
            units_per_em,
        })
    }

    fn characters(&self) -> impl Iterator<Item = char> + '_ {
        self.font
            .charmap()
            .mappings()
            .filter_map(|(codepoint, _)| char::from_u32(codepoint))
    }

    /// Returns the script the font declares it was designed for, but only
    /// when every design language is written in a script with a specimen
    /// pair. Declared languages are unordered, so a font that lists any Latin
    /// language is treated as Latin-first.
    fn declared_script(&self) -> Option<SpecimenScript> {
        let meta = self.font.meta().ok()?;
        let record = meta
            .data_maps()
            .iter()
            .find(|record| record.tag() == Tag::new(b"dlng"))?;
        // read-fonts parses `dlng` into `Metadata::ScriptLangTags`, but its
        // `ScriptLangTag::read_len_at` finds the next comma from the start of
        // the whole list rather than the current tag, so every tag after the
        // first is mis-sized (still true in read-fonts 0.43). Split the raw
        // bytes here instead.
        let start = record.data_offset().to_u32() as usize;
        let end = start + record.data_length() as usize;
        let bytes = meta.offset_data().as_bytes().get(start..end)?;
        let declared: Vec<DeclaredScript> = std::str::from_utf8(bytes)
            .ok()?
            .split(',')
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(SpecimenScript::from_language_tag)
            .collect();
        let mut scripts = declared.iter().map(|script| match script {
            DeclaredScript::Specimen(script) => Some(*script),
            DeclaredScript::Other => None,
        });
        let first = scripts.next()??;
        scripts.all(|script| script.is_some()).then_some(first)
    }

    fn script_specimen(&self, script: SpecimenScript, coverage: &Coverage) -> Option<Specimen> {
        if let Some(specimen) = self.shaped_specimen(script.pair()) {
            return Some(specimen);
        }

        let drawn: String = coverage
            .letters(script)
            .into_iter()
            .filter(|letter| self.shaped_specimen(&letter.to_string()).is_some())
            .take(2)
            .collect();
        self.shaped_specimen(&drawn)
    }

    /// Shapes `text` and returns it only when every cluster draws ink.
    fn shaped_specimen(&self, text: &str) -> Option<Specimen> {
        if text.is_empty() {
            return None;
        }

        let font = harfrust::FontRef::new(self.data).ok()?;
        let data = ShaperData::new(&font);
        let shaper = data.shaper(&font).build();
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let shaped = shaper.shape(buffer, ShapeOptions::new());

        let mut placed = Vec::new();
        let mut inked_clusters = Vec::new();
        let mut pen_x = 0.0;
        for (info, position) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            if info.glyph_id == 0 {
                return None;
            }
            if self.has_ink(info.glyph_id) {
                inked_clusters.push(info.cluster);
            }
            placed.push(PlacedGlyph {
                glyph_id: info.glyph_id,
                x: pen_x + f64::from(position.x_offset),
                y: f64::from(position.y_offset),
            });
            pen_x += f64::from(position.x_advance);
        }

        let every_cluster_inked = shaped
            .glyph_infos()
            .iter()
            .all(|info| inked_clusters.contains(&info.cluster));
        if !every_cluster_inked {
            return None;
        }

        let right_to_left = text
            .chars()
            .any(|character| matches!(character.script(), Script::Arabic | Script::Hebrew));
        self.outline(text.to_string(), &placed, right_to_left)
    }

    /// Places the first two glyphs with ink by glyph order, skipping `.notdef`.
    fn glyph_order_specimen(&self) -> Option<Specimen> {
        let glyph_count = u32::from(self.font.maxp().ok()?.num_glyphs());
        let metrics = self
            .font
            .glyph_metrics(Size::unscaled(), LocationRef::default());

        let mut placed = Vec::new();
        let mut pen_x = 0.0;
        for glyph_id in (1..glyph_count)
            .filter(|glyph_id| self.has_ink(*glyph_id))
            .take(2)
        {
            placed.push(PlacedGlyph {
                glyph_id,
                x: pen_x,
                y: 0.0,
            });
            pen_x += f64::from(
                metrics
                    .advance_width(GlyphId::new(glyph_id))
                    .unwrap_or_default(),
            );
        }
        self.outline(String::new(), &placed, false)
    }

    fn has_ink(&self, glyph_id: u32) -> bool {
        let mut pen = SvgPen::new(0.0, 0.0);
        self.draw(glyph_id, &mut pen);
        pen.bounds.is_some()
    }

    fn draw(&self, glyph_id: u32, pen: &mut SvgPen) {
        let outlines = self.font.outline_glyphs();
        let Some(glyph) = outlines.get(GlyphId::new(glyph_id)) else {
            return;
        };
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        // A glyph that fails to draw simply contributes no ink.
        let _ = glyph.draw(settings, pen);
    }

    fn outline(
        &self,
        text: String,
        placed: &[PlacedGlyph],
        right_to_left: bool,
    ) -> Option<Specimen> {
        let mut outline = String::new();
        let mut bounds: Option<Bounds> = None;
        for glyph in placed {
            let mut pen = SvgPen::new(glyph.x, glyph.y);
            self.draw(glyph.glyph_id, &mut pen);
            outline.push_str(&pen.path);
            bounds = match (bounds, pen.bounds) {
                (Some(current), Some(next)) => Some(current.union(next)),
                (current, next) => current.or(next),
            };
        }

        let bounds = bounds?;
        Some(Specimen {
            text,
            outline,
            view_box: self.fit(bounds),
            right_to_left,
        })
    }

    /// Pads the ink and grows the viewport to the minimum height, centred on
    /// the ink, which caps how far short marks are magnified.
    fn fit(&self, ink: Bounds) -> ViewBox {
        let padding = self.units_per_em * PADDING_EM;
        let ink_height = ink.max_y - ink.min_y;
        let height = (ink_height + 2.0 * padding).max(self.units_per_em * MIN_VIEW_HEIGHT_EM);

        ViewBox {
            x: ink.min_x - padding,
            y: ink.min_y - (height - ink_height) / 2.0,
            width: ink.max_x - ink.min_x + 2.0 * padding,
            height,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Bounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Bounds {
    fn point(x: f64, y: f64) -> Self {
        Self {
            min_x: x,
            min_y: y,
            max_x: x,
            max_y: y,
        }
    }

    fn union(self, other: Bounds) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }
}

/// Collects outline commands as SVG path data, offset by the glyph's origin
/// and flipped to y down.
struct SvgPen {
    origin_x: f64,
    origin_y: f64,
    path: String,
    bounds: Option<Bounds>,
}

impl SvgPen {
    fn new(origin_x: f64, origin_y: f64) -> Self {
        Self {
            origin_x,
            origin_y,
            path: String::new(),
            bounds: None,
        }
    }

    fn command(&mut self, command: char, points: &[(f32, f32)]) {
        self.path.push(command);
        for (index, (x, y)) in points.iter().enumerate() {
            let x = self.origin_x + f64::from(*x);
            let y = -(self.origin_y + f64::from(*y));
            let point = Bounds::point(x, y);
            self.bounds = Some(self.bounds.map_or(point, |bounds| bounds.union(point)));

            if index > 0 {
                self.path.push(' ');
            }
            let _ = write!(self.path, "{} {}", round(x), round(y));
        }
    }
}

impl OutlinePen for SvgPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.command('M', &[(x, y)]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.command('L', &[(x, y)]);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.command('Q', &[(cx0, cy0), (x, y)]);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.command('C', &[(cx0, cy0), (cx1, cy1), (x, y)]);
    }

    fn close(&mut self) {
        self.path.push('Z');
    }
}

fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests;

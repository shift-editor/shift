//! Binds compiled font bytes to one variation location.

use std::cell::OnceCell;
use std::collections::{HashMap, HashSet};

use harfrust::{ShaperData, ShaperInstance};
use serde::Serialize;
use skrifa::instance::{Location, Size};
use skrifa::outline::OutlineGlyphCollection;
use skrifa::raw::TableProvider;
use skrifa::raw::tables::os2::SelectionFlags;
use skrifa::{FontRef, GlyphId, MetadataProvider};

use crate::location::resolve;
use crate::{AxisValue, Coordinates, ProofError};

/// Vertical metrics at a location, in font units with y up.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofMetrics {
    pub units_per_em: u16,
    pub ascender: f32,
    /// Negative below the baseline.
    pub descender: f32,
    pub x_height: Option<f32>,
    pub cap_height: Option<f32>,
}

/// A compiled font bound to one variation location, ready to shape and
/// outline text.
///
/// Holds borrowed font bytes plus the shaping tables HarfRust builds from
/// them, so one binding can shape many runs without re-reading the font.
pub struct ProofFont<'a> {
    pub(crate) font: FontRef<'a>,
    pub(crate) shaper_font: harfrust::FontRef<'a>,
    pub(crate) shaper_data: ShaperData,
    pub(crate) shaper_instance: Option<ShaperInstance>,
    pub(crate) outlines: OutlineGlyphCollection<'a>,
    pub(crate) location: Location,
    axes: Vec<AxisValue>,
    // non-reactive: built on the first lookup by name and never changed.
    names: OnceCell<HashMap<String, u32>>,
}

impl<'a> ProofFont<'a> {
    /// Binds `data` to `coordinates`; a static font takes no coordinates.
    ///
    /// Shaping and outlines use the same normalized coordinates, so `GPOS`,
    /// `HVAR`, and `gvar` agree. A font that maps no characters still binds,
    /// so glyphs can be shaped or outlined by id; see
    /// [`Self::require_characters`].
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::UnreadableFont`] or
    /// [`ProofError::UnshapeableFont`] when the bytes are not a font, and
    /// [`ProofError::RepeatedAxis`], [`ProofError::UnknownAxis`], or
    /// [`ProofError::AxisOutOfRange`] when a coordinate repeats or blanks a
    /// tag, names an axis the font lacks, or lies outside the axis range
    /// (`-1..=1` for normalized coordinates).
    pub fn new(data: &'a [u8], coordinates: &Coordinates) -> Result<Self, ProofError> {
        let font = FontRef::new(data).map_err(ProofError::UnreadableFont)?;
        let shaper_font = harfrust::FontRef::new(data).map_err(|_| ProofError::UnshapeableFont)?;
        let resolved = resolve(&font, coordinates)?;
        let shaper_instance = (!resolved.axes.is_empty()).then(|| {
            let coords = resolved.location.coords().iter().map(|coord| {
                // HarfRust and skrifa link different read-fonts versions.
                harfrust::NormalizedCoord::from_bits(coord.to_bits())
            });
            ShaperInstance::from_coords(&shaper_font, coords)
        });
        Ok(Self {
            shaper_data: ShaperData::new(&shaper_font),
            outlines: font.outline_glyphs(),
            font,
            shaper_font,
            shaper_instance,
            location: resolved.location,
            axes: resolved.axes,
            names: OnceCell::new(),
        })
    }

    /// Fails unless the character map covers at least one character.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::NoCharacters`] for an empty character map.
    pub fn require_characters(&self) -> Result<(), ProofError> {
        match self.font.charmap().mappings().next() {
            Some(_) => Ok(()),
            None => Err(ProofError::NoCharacters),
        }
    }

    /// Every `fvar` axis, in font order, at its user-space value.
    ///
    /// For normalized coordinates the user value is recovered by inverting
    /// `avar` segment maps, rounded to tenths.
    pub fn location(&self) -> &[AxisValue] {
        &self.axes
    }

    /// Units per em from `head`.
    pub fn units_per_em(&self) -> u16 {
        self.font.head().map_or(1000, |head| head.units_per_em())
    }

    /// Vertical metrics the designer authored, at the bound location.
    ///
    /// Ascender and descender come from `OS/2` typo metrics rather than
    /// `hhea`: fontc pads `hhea.ascender` to at least 1.2 em of line height,
    /// so it does not match the source's ascender. Any variation delta
    /// applied to the `hhea` value is carried over to the typo value.
    pub fn metrics(&self) -> ProofMetrics {
        let metrics = self.font.metrics(Size::unscaled(), &self.location);
        let (ascender, descender) = self.typo_vertical_metrics(metrics.ascent, metrics.descent);
        ProofMetrics {
            units_per_em: metrics.units_per_em,
            ascender,
            descender,
            x_height: metrics.x_height,
            cap_height: metrics.cap_height,
        }
    }

    // Rebases skrifa's `hhea` ascent and descent onto `OS/2` typo values;
    // returns them unchanged when skrifa already used typo metrics or either
    // table is missing.
    fn typo_vertical_metrics(&self, ascent: f32, descent: f32) -> (f32, f32) {
        let (Ok(os2), Ok(hhea)) = (self.font.os2(), self.font.hhea()) else {
            return (ascent, descent);
        };
        if os2
            .fs_selection()
            .contains(SelectionFlags::USE_TYPO_METRICS)
        {
            return (ascent, descent);
        }

        let ascender_shift = i32::from(hhea.ascender().to_i16()) - i32::from(os2.s_typo_ascender());
        let descender_shift =
            i32::from(hhea.descender().to_i16()) - i32::from(os2.s_typo_descender());
        (
            ascent - ascender_shift as f32,
            descent - descender_shift as f32,
        )
    }

    /// Glyph mapped to `character` by `cmap`.
    pub fn glyph_for_char(&self, character: char) -> Option<u32> {
        self.font.charmap().map(character).map(GlyphId::to_u32)
    }

    /// Glyph named `name` in `post`, when the font stores names.
    pub fn glyph_by_name(&self, name: &str) -> Option<u32> {
        let names = self.names.get_or_init(|| {
            self.font
                .glyph_names()
                .iter()
                .map(|(glyph_id, name)| (name.to_string(), glyph_id.to_u32()))
                .collect()
        });
        names.get(name).copied()
    }

    /// Characters of `text` the character map does not cover, in order of
    /// first appearance; control characters are ignored.
    pub fn missing_characters(&self, text: &str) -> Vec<char> {
        let charmap = self.font.charmap();
        let mut seen = HashSet::new();
        text.chars()
            .filter(|character| !character.is_control())
            .filter(|character| charmap.map(*character).is_none())
            .filter(|character| seen.insert(*character))
            .collect()
    }
}

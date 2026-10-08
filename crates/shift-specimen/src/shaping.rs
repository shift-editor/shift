//! Shapes text with HarfRust and outlines it with skrifa at a variation
//! location.
//!
//! This is the one place Shift shapes compiled fonts: recent-file specimens
//! and proofs both go through [`shape_positions`]. Coordinates are font units
//! with the y axis pointing up and the run's pen origin at `(0, 0)`.
//!
//! Ported from Andrea Fomera's `shift proof` prototype.

use std::collections::HashSet;
use std::fmt;

use harfrust::{ShapeOptions, ShaperData, ShaperInstance, UnicodeBuffer};
use skrifa::instance::{Location, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::os2::SelectionFlags;
use skrifa::raw::TableProvider;
use skrifa::string::StringId;
use skrifa::{FontRef, GlyphId, MetadataProvider};

/// Width of the placeholder drawn for a missing glyph with no ink, in ems.
const PLACEHOLDER_MIN_ADVANCE_EM: f32 = 0.5;
/// Height of the placeholder, in ems.
const PLACEHOLDER_HEIGHT_EM: f32 = 0.7;
/// Stroke of the placeholder, in ems.
const PLACEHOLDER_STROKE_EM: f32 = 0.04;

/// Why a compiled font cannot be shaped at a requested location.
#[derive(Clone, Debug, PartialEq)]
pub enum ShapingError {
    /// The bytes are not a font skrifa can read.
    Unreadable(String),
    /// A coordinate names an axis the font does not have.
    UnknownAxis { tag: String, available: Vec<String> },
    /// A coordinate repeats an axis.
    RepeatedAxis(String),
    /// A coordinate lies outside its axis range.
    OutOfRange {
        tag: String,
        value: f32,
        min: f32,
        max: f32,
    },
}

impl fmt::Display for ShapingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(error) => write!(f, "compiled font is unreadable: {error}"),
            Self::UnknownAxis { tag, available } => write!(
                f,
                "the font has no {tag:?} axis; available axes: [{}]",
                available.join(", ")
            ),
            Self::RepeatedAxis(tag) => write!(f, "axis {tag:?} is repeated in the location"),
            Self::OutOfRange {
                tag,
                value,
                min,
                max,
            } => write!(f, "{tag}={value} is outside the axis range {min}..{max}"),
        }
    }
}

impl std::error::Error for ShapingError {}

/// One shaped glyph as HarfRust positions it, in font units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GlyphPosition {
    pub glyph_id: u32,
    /// Byte offset in the shaped text of the first character this glyph represents.
    pub cluster: u32,
    pub x_offset: i32,
    pub y_offset: i32,
    pub x_advance: i32,
}

/// Shapes `text` at `variations` (user-space `(tag, value)` pairs).
///
/// Returns `None` when `data` is not a font HarfRust can read.
pub fn shape_positions(
    data: &[u8],
    text: &str,
    variations: &[(String, f32)],
) -> Option<Vec<GlyphPosition>> {
    let font = harfrust::FontRef::new(data).ok()?;
    let shaper_data = ShaperData::new(&font);
    let instance = (!variations.is_empty()).then(|| {
        ShaperInstance::from_variations(
            &font,
            variations.iter().map(|(tag, value)| (tag.as_str(), *value)),
        )
    });
    let shaper = shaper_data
        .shaper(&font)
        .instance(instance.as_ref())
        .build();
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let shaped = shaper.shape(buffer, ShapeOptions::new());

    Some(
        shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| GlyphPosition {
                glyph_id: info.glyph_id,
                cluster: info.cluster,
                x_offset: position.x_offset,
                y_offset: position.y_offset,
                x_advance: position.x_advance,
            })
            .collect(),
    )
}

/// One outline command in font units, y up.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    Move(f32, f32),
    Line(f32, f32),
    Quad(f32, f32, f32, f32),
    Cubic(f32, f32, f32, f32, f32, f32),
    Close,
}

/// A glyph placed relative to its run's pen origin.
#[derive(Clone, Debug, PartialEq)]
pub struct ShapedGlyph {
    pub glyph_id: u32,
    /// Outline offset by the glyph's pen position, in font units.
    pub segments: Vec<Segment>,
    /// Whether the font had no glyph for this character; an inkless missing
    /// glyph is drawn as a hollow placeholder box.
    pub missing: bool,
    /// Byte offset in the shaped text of the first character this glyph represents.
    pub cluster: usize,
    /// Pen position, in font units from the run origin.
    pub x: f32,
    /// Horizontal advance, in font units, including placeholder widths.
    pub advance: f32,
}

/// A line of shaped glyphs in font units.
#[derive(Clone, Debug, PartialEq)]
pub struct ShapedRun {
    pub glyphs: Vec<ShapedGlyph>,
    /// Total advance, including placeholder widths.
    pub advance: f32,
}

/// Vertical metrics at a location, in font units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VerticalMetrics {
    pub units_per_em: u16,
    pub ascender: f32,
    /// Negative below the baseline.
    pub descender: f32,
    pub x_height: Option<f32>,
    pub cap_height: Option<f32>,
}

/// One variation axis of a compiled font, in user space.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisRange {
    pub tag: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

/// A named instance of a compiled font, in user space.
#[derive(Clone, Debug, PartialEq)]
pub struct NamedInstance {
    pub name: String,
    pub location: Vec<(String, f32)>,
}

/// A compiled font bound to one variation location.
pub struct ShapingFont<'a> {
    data: &'a [u8],
    font: FontRef<'a>,
    /// Every axis with its user-space value, in font axis order.
    variations: Vec<(String, f32)>,
    location: Location,
}

impl<'a> ShapingFont<'a> {
    /// Binds `data` to its default location.
    ///
    /// # Errors
    ///
    /// Returns [`ShapingError::Unreadable`] when the bytes are not a font.
    pub fn new(data: &'a [u8]) -> Result<Self, ShapingError> {
        let font =
            FontRef::new(data).map_err(|error| ShapingError::Unreadable(error.to_string()))?;
        let variations = font
            .axes()
            .iter()
            .map(|axis| (axis.tag().to_string(), axis.default_value()))
            .collect();
        Ok(Self::bound(data, font, variations))
    }

    /// Returns the same font at `coordinates`; omitted axes keep their defaults.
    ///
    /// # Errors
    ///
    /// Returns an error when a coordinate names an unknown axis, repeats one,
    /// or lies outside its range.
    pub fn at(&self, coordinates: &[(String, f32)]) -> Result<Self, ShapingError> {
        let axes = self.axes();
        let mut variations: Vec<(String, f32)> = axes
            .iter()
            .map(|axis| (axis.tag.clone(), axis.default))
            .collect();
        let mut seen = HashSet::new();
        for (tag, value) in coordinates {
            if !seen.insert(tag.clone()) {
                return Err(ShapingError::RepeatedAxis(tag.clone()));
            }
            let Some(index) = axes.iter().position(|axis| &axis.tag == tag) else {
                return Err(ShapingError::UnknownAxis {
                    tag: tag.clone(),
                    available: axes.iter().map(|axis| axis.tag.clone()).collect(),
                });
            };
            let axis = &axes[index];
            if *value < axis.min || *value > axis.max {
                return Err(ShapingError::OutOfRange {
                    tag: tag.clone(),
                    value: *value,
                    min: axis.min,
                    max: axis.max,
                });
            }
            variations[index].1 = *value;
        }
        Ok(Self::bound(self.data, self.font.clone(), variations))
    }

    fn bound(data: &'a [u8], font: FontRef<'a>, variations: Vec<(String, f32)>) -> Self {
        let location = font
            .axes()
            .location(variations.iter().map(|(tag, value)| (tag.as_str(), *value)));
        Self {
            data,
            font,
            variations,
            location,
        }
    }

    pub fn axes(&self) -> Vec<AxisRange> {
        self.font
            .axes()
            .iter()
            .map(|axis| AxisRange {
                tag: axis.tag().to_string(),
                min: axis.min_value(),
                default: axis.default_value(),
                max: axis.max_value(),
            })
            .collect()
    }

    /// Number of glyphs in the font, `.notdef` included.
    pub fn glyph_count(&self) -> u32 {
        self.font
            .maxp()
            .map(|maxp| u32::from(maxp.num_glyphs()))
            .unwrap_or_default()
    }

    /// Every axis with the user-space value this font is bound to.
    pub fn location(&self) -> &[(String, f32)] {
        &self.variations
    }

    /// Named instances from `fvar`, with their subfamily names.
    pub fn named_instances(&self) -> Vec<NamedInstance> {
        let tags: Vec<String> = self.axes().into_iter().map(|axis| axis.tag).collect();
        self.font
            .named_instances()
            .iter()
            .map(|instance| NamedInstance {
                name: self
                    .font
                    .localized_strings(instance.subfamily_name_id())
                    .english_or_first()
                    .map(|name| name.to_string())
                    .unwrap_or_default(),
                location: tags.iter().cloned().zip(instance.user_coords()).collect(),
            })
            .collect()
    }

    /// The vertical metrics the designer authored, at this location.
    ///
    /// Ascender and descender come from `OS/2` typo metrics rather than
    /// `hhea`, because fontc pads `hhea` line height. Any variation delta
    /// skrifa applied to `hhea` carries over to the typo values.
    pub fn metrics(&self) -> VerticalMetrics {
        let metrics = self.font.metrics(Size::unscaled(), &self.location);
        let (ascender, descender) = self.typo_vertical_metrics(metrics.ascent, metrics.descent);
        VerticalMetrics {
            units_per_em: metrics.units_per_em,
            ascender,
            descender,
            x_height: metrics.x_height,
            cap_height: metrics.cap_height,
        }
    }

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
        let ascender_shift = f32::from(hhea.ascender().to_i16() - os2.s_typo_ascender());
        let descender_shift = f32::from(hhea.descender().to_i16() - os2.s_typo_descender());
        (ascent - ascender_shift, descent - descender_shift)
    }

    /// Characters of `text` the font does not map, in order of first
    /// appearance; control characters are ignored.
    pub fn missing_characters(&self, text: &str) -> Vec<char> {
        let charmap = self.font.charmap();
        let mut seen = HashSet::new();
        text.chars()
            .filter(|character| !character.is_control())
            .filter(|character| charmap.map(*character).is_none())
            .filter(|character| seen.insert(*character))
            .collect()
    }

    /// The glyph's name from `post` or `CFF`, if the font has one.
    pub fn glyph_name(&self, glyph_id: u32) -> Option<String> {
        self.font
            .glyph_names()
            .get(GlyphId::new(glyph_id))
            .map(|name| name.to_string())
    }

    /// The English (or first) entry for `name_id` in the `name` table.
    pub fn name(&self, name_id: u16) -> Option<String> {
        self.font
            .localized_strings(StringId::new(name_id))
            .english_or_first()
            .map(|name| name.to_string())
    }

    /// The glyph with `name` in the font's `post` names, if any.
    pub fn glyph_by_name(&self, name: &str) -> Option<u32> {
        self.font
            .glyph_names()
            .iter()
            .find(|(_, glyph_name)| glyph_name.as_str() == name)
            .map(|(id, _)| id.to_u32())
    }

    /// Shapes `text` with real features and kerning at this location.
    pub fn shape(&self, text: &str) -> ShapedRun {
        let positions = shape_positions(self.data, text, &self.variations).unwrap_or_default();
        let units_per_em = f32::from(self.metrics().units_per_em);
        let mut glyphs = Vec::with_capacity(positions.len());
        let mut pen_x = 0.0;
        for position in positions {
            let x = pen_x + position.x_offset as f32;
            let y = position.y_offset as f32;
            let missing = position.glyph_id == 0;
            let mut advance = position.x_advance as f32;
            let mut segments = self.outline(position.glyph_id, x, y);
            if missing && segments.is_empty() {
                advance = advance.max(units_per_em * PLACEHOLDER_MIN_ADVANCE_EM);
                segments = placeholder_box(x, advance, units_per_em);
            }
            glyphs.push(ShapedGlyph {
                glyph_id: position.glyph_id,
                segments,
                missing,
                cluster: position.cluster as usize,
                x: pen_x,
                advance,
            });
            pen_x += advance;
        }
        ShapedRun {
            glyphs,
            advance: pen_x,
        }
    }

    /// Places glyphs by ID with their advances at this location, unshaped.
    pub fn glyph_run(&self, glyph_ids: &[u32]) -> ShapedRun {
        let metrics = self.font.glyph_metrics(Size::unscaled(), &self.location);
        let mut glyphs = Vec::with_capacity(glyph_ids.len());
        let mut pen_x = 0.0;
        for (index, glyph_id) in glyph_ids.iter().enumerate() {
            let advance = metrics
                .advance_width(GlyphId::new(*glyph_id))
                .unwrap_or_default();
            glyphs.push(ShapedGlyph {
                glyph_id: *glyph_id,
                segments: self.outline(*glyph_id, pen_x, 0.0),
                missing: false,
                cluster: index,
                x: pen_x,
                advance,
            });
            pen_x += advance;
        }
        ShapedRun {
            glyphs,
            advance: pen_x,
        }
    }

    fn outline(&self, glyph_id: u32, x: f32, y: f32) -> Vec<Segment> {
        let mut pen = SegmentPen {
            x,
            y,
            segments: Vec::new(),
        };
        if let Some(glyph) = self.font.outline_glyphs().get(GlyphId::new(glyph_id)) {
            let settings = DrawSettings::unhinted(Size::unscaled(), &self.location);
            // A glyph that fails to draw contributes no ink, like an empty one.
            if glyph.draw(settings, &mut pen).is_err() {
                pen.segments.clear();
            }
        }
        pen.segments
    }
}

fn placeholder_box(x: f32, advance: f32, units_per_em: f32) -> Vec<Segment> {
    let inset = advance * 0.1;
    hollow_box(
        (x + inset, 0.0),
        (x + advance - inset, units_per_em * PLACEHOLDER_HEIGHT_EM),
        units_per_em * PLACEHOLDER_STROKE_EM,
    )
}

/// A hollow rectangle whose inner contour runs opposite the outer one, so a
/// nonzero fill leaves the middle empty.
pub fn hollow_box(
    (left, bottom): (f32, f32),
    (right, top): (f32, f32),
    stroke: f32,
) -> Vec<Segment> {
    vec![
        Segment::Move(left, bottom),
        Segment::Line(right, bottom),
        Segment::Line(right, top),
        Segment::Line(left, top),
        Segment::Close,
        Segment::Move(left + stroke, bottom + stroke),
        Segment::Line(left + stroke, top - stroke),
        Segment::Line(right - stroke, top - stroke),
        Segment::Line(right - stroke, bottom + stroke),
        Segment::Close,
    ]
}

struct SegmentPen {
    x: f32,
    y: f32,
    segments: Vec<Segment>,
}

impl OutlinePen for SegmentPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.segments.push(Segment::Move(self.x + x, self.y + y));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.segments.push(Segment::Line(self.x + x, self.y + y));
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.segments.push(Segment::Quad(
            self.x + cx0,
            self.y + cy0,
            self.x + x,
            self.y + y,
        ));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.segments.push(Segment::Cubic(
            self.x + cx0,
            self.y + cy0,
            self.x + cx1,
            self.y + cy1,
            self.x + x,
            self.y + y,
        ));
    }

    fn close(&mut self) {
        self.segments.push(Segment::Close);
    }
}

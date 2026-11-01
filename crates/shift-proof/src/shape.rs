//! Shapes text with shift-text and outlines glyphs with skrifa at a bound
//! location.
//!
//! Every coordinate is in font units with the y axis pointing up.
//! [`ProofFont::shape_glyphs`] and [`ProofFont::outline`] are the raw
//! primitives; [`ProofFont::shape`] and [`ProofFont::set_line`] combine them
//! into runs whose outlines are already placed and whose missing glyphs are
//! flagged.

use serde::Serialize;
use shift_text::shape::{FontGlyphs, NOTDEF, ShapeDirection, ShapeRequest, Unit};
use skrifa::instance::Size;
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::TableProvider;
use skrifa::{GlyphId, MetadataProvider};

use crate::{LanguageSetting, ProofError, ProofFont, ScriptSetting, ShapingOptions, TextDirection};

/// Width of the placeholder box drawn for an inkless missing glyph, in ems.
const PLACEHOLDER_MIN_ADVANCE_EM: f32 = 0.5;
/// Height of the placeholder box, in ems.
const PLACEHOLDER_HEIGHT_EM: f32 = 0.7;
/// Stroke thickness of the placeholder box, in ems.
const PLACEHOLDER_STROKE_EM: f32 = 0.04;

/// One outline command.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    Move(f32, f32),
    Line(f32, f32),
    Quad(f32, f32, f32, f32),
    Cubic(f32, f32, f32, f32, f32, f32),
    Close,
}

impl Segment {
    /// Returns the command moved by `(dx, dy)`.
    pub fn translate(self, dx: f32, dy: f32) -> Self {
        match self {
            Self::Move(x, y) => Self::Move(x + dx, y + dy),
            Self::Line(x, y) => Self::Line(x + dx, y + dy),
            Self::Quad(cx, cy, x, y) => Self::Quad(cx + dx, cy + dy, x + dx, y + dy),
            Self::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                Self::Cubic(cx0 + dx, cy0 + dy, cx1 + dx, cy1 + dy, x + dx, y + dy)
            }
            Self::Close => Self::Close,
        }
    }
}

/// One glyph as shaping placed it, before outlining.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShapedGlyph {
    /// Glyph id in the font; `0` is `.notdef`.
    pub glyph_id: u32,
    /// Byte offset in the shaped text of the first character this glyph
    /// represents.
    pub cluster: usize,
    pub x_advance: f32,
    /// Negative for vertical text, which advances downward.
    pub y_advance: f32,
    pub x_offset: f32,
    pub y_offset: f32,
}

/// Shaping's output for one run, in visual order.
#[derive(Clone, Debug, PartialEq)]
pub struct ShapedText {
    pub glyphs: Vec<ShapedGlyph>,
    /// The direction given, or the one guessed from the text.
    pub direction: TextDirection,
}

/// A glyph with its outline placed relative to the run's pen origin.
#[derive(Clone, Debug)]
pub struct PlacedGlyph {
    pub glyph_id: u32,
    /// Outline offset by the glyph's pen position and shaping offsets.
    pub segments: Vec<Segment>,
    /// Whether the glyph stands for a character the font does not map or a
    /// glyph name it does not have.
    pub missing: bool,
    /// Byte offset in the line of the glyph's first character.
    pub cluster: usize,
    /// Pen position from the run origin.
    pub x: f32,
    /// Pen position from the run origin; below zero in vertical runs.
    pub y: f32,
    /// Advance along the line, widened for a placeholder box.
    pub advance: f32,
}

/// A run of placed glyphs in visual order, in font units.
#[derive(Clone, Debug)]
pub struct ShapedRun {
    pub glyphs: Vec<PlacedGlyph>,
    /// Total advance along the line, including placeholder widths.
    pub advance: f32,
    pub direction: TextDirection,
}

/// One glyph of a run, as reported to people and agents.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphReport {
    /// Glyph name from `post`, when the font stores names.
    pub name: Option<String>,
    pub glyph_id: u32,
    /// Byte offset of the glyph's first character in the line.
    pub cluster: usize,
    /// Pen position along the line, in font units.
    pub x: f32,
    /// Advance along the line, in font units.
    pub advance: f32,
    pub missing: bool,
}

/// A glyph about to be placed: shaped, or named directly.
pub(crate) struct RunGlyph {
    pub glyph: ShapedGlyph,
    pub missing: bool,
}

impl RunGlyph {
    /// A shaped glyph, missing when it is `.notdef`.
    pub(crate) fn shaped(glyph: ShapedGlyph) -> Self {
        Self {
            missing: glyph.glyph_id == NOTDEF,
            glyph,
        }
    }
}

impl ProofFont<'_> {
    /// Shapes `text` as one run at the bound location with `options`; the
    /// script, language, and direction it leaves out are guessed from the
    /// text, and every default feature the font compiles applies (kerning
    /// included).
    ///
    /// Characters the font does not map come back as glyph `0`.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::Shape`] when the text is too long to shape.
    pub fn shape_glyphs(
        &self,
        text: &str,
        options: &ShapingOptions,
    ) -> Result<ShapedText, ProofError> {
        let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
        let starts: Vec<usize> = text.char_indices().map(|(start, _)| start).collect();
        let script = options.script.as_ref().map(ScriptSetting::tag);
        let direction = options.direction.map(ShapeDirection::from);
        self.shape_units(&units, &starts, direction, script, options)
    }

    /// Shapes `units` as one run with shift-text, in `direction` (`None`
    /// guesses it from the script) and `script` (`None` guesses it from the
    /// characters), with `options`' language and features. `starts` holds
    /// each unit's byte offset, which the glyphs' clusters become.
    pub(crate) fn shape_units(
        &self,
        units: &[Unit<u32>],
        starts: &[usize],
        direction: Option<ShapeDirection>,
        script: Option<&str>,
        options: &ShapingOptions,
    ) -> Result<ShapedText, ProofError> {
        let features = options.shape_features();
        let request = ShapeRequest {
            units,
            location: self.coords.as_slice(),
            direction,
            script,
            language: options.language.as_ref().map(LanguageSetting::tag),
            features: &features,
        };
        let shaped = self.shaper.shape(&FontGlyphs, &request, None)?;
        let glyphs = shaped
            .glyphs
            .into_iter()
            .map(|glyph| ShapedGlyph {
                glyph_id: glyph.glyph_id.unwrap_or(NOTDEF),
                cluster: byte_offset(starts, glyph.cluster),
                x_advance: glyph.x_advance as f32,
                y_advance: glyph.y_advance as f32,
                x_offset: glyph.x_offset as f32,
                y_offset: glyph.y_offset as f32,
            })
            .collect();
        Ok(ShapedText {
            glyphs,
            direction: shaped.direction.into(),
        })
    }

    /// Draws one glyph unhinted at the bound location, with its origin at
    /// `(0, 0)`.
    ///
    /// An unknown glyph id yields no segments; a glyph whose outline fails
    /// part-way keeps the segments drawn before the failure.
    pub fn outline(&self, glyph_id: u32) -> Vec<Segment> {
        let mut pen = SegmentPen::default();
        if let Some(glyph) = self.outlines.get(GlyphId::new(glyph_id)) {
            let settings = DrawSettings::unhinted(Size::unscaled(), &self.location);
            // A glyph that fails to draw contributes only what it drew.
            let _ = glyph.draw(settings, &mut pen);
        }
        pen.segments
    }

    /// Advance width of a glyph at the bound location, from `hmtx` and
    /// `HVAR`.
    pub fn advance_width(&self, glyph_id: u32) -> Option<f32> {
        self.font
            .glyph_metrics(Size::unscaled(), &self.location)
            .advance_width(GlyphId::new(glyph_id))
    }

    /// Number of glyphs in the font, from `maxp`.
    pub fn glyph_count(&self) -> u32 {
        self.font
            .maxp()
            .map_or(0, |maxp| u32::from(maxp.num_glyphs()))
    }

    /// Glyph name from `post`, when the font stores names.
    pub fn glyph_name(&self, glyph_id: u32) -> Option<String> {
        self.font
            .glyph_names()
            .get(GlyphId::new(glyph_id))
            .map(|name| name.to_string())
    }

    /// Shapes `text` and places every glyph's outline on one run; `/name`
    /// tokens are not interpreted (see [`Self::set_line`]).
    ///
    /// A `.notdef` glyph is flagged `missing`; when it has no ink it becomes
    /// a hollow placeholder box at least half an em wide, so the gap is
    /// visible.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::Shape`] when the text is too long to shape.
    pub fn shape(&self, text: &str, options: &ShapingOptions) -> Result<ShapedRun, ProofError> {
        let shaped = self.shape_glyphs(text, options)?;
        let glyphs = shaped.glyphs.into_iter().map(RunGlyph::shaped);
        Ok(self.place(glyphs, shaped.direction))
    }

    /// Describes each glyph of `run` with its name.
    pub fn glyph_reports(&self, run: &ShapedRun) -> Vec<GlyphReport> {
        run.glyphs
            .iter()
            .map(|glyph| GlyphReport {
                name: self.glyph_name(glyph.glyph_id),
                glyph_id: glyph.glyph_id,
                cluster: glyph.cluster,
                x: if run.direction.is_vertical() {
                    glyph.y.abs()
                } else {
                    glyph.x
                },
                advance: glyph.advance,
                missing: glyph.missing,
            })
            .collect()
    }

    /// Places glyphs one after another from the pen origin, outlining each.
    pub(crate) fn place(
        &self,
        glyphs: impl IntoIterator<Item = RunGlyph>,
        direction: TextDirection,
    ) -> ShapedRun {
        let units_per_em = f32::from(self.units_per_em());
        let vertical = direction.is_vertical();
        let (mut pen_x, mut pen_y) = (0.0_f32, 0.0_f32);
        let mut placed = Vec::new();
        for RunGlyph { glyph, missing } in glyphs {
            let mut segments: Vec<Segment> = self
                .outline(glyph.glyph_id)
                .into_iter()
                .map(|segment| segment.translate(pen_x + glyph.x_offset, pen_y + glyph.y_offset))
                .collect();
            let mut advance = if vertical {
                -glyph.y_advance
            } else {
                glyph.x_advance
            };
            if missing && segments.is_empty() {
                advance = advance.max(units_per_em * PLACEHOLDER_MIN_ADVANCE_EM);
                segments = placeholder_box(pen_x, pen_y, advance, units_per_em, vertical);
            }
            placed.push(PlacedGlyph {
                glyph_id: glyph.glyph_id,
                segments,
                missing,
                cluster: glyph.cluster,
                x: pen_x,
                y: pen_y,
                advance,
            });
            if vertical {
                pen_x += glyph.x_advance;
                pen_y -= advance;
            } else {
                pen_x += advance;
                pen_y += glyph.y_advance;
            }
        }

        ShapedRun {
            advance: if vertical { -pen_y } else { pen_x },
            glyphs: placed,
            direction,
        }
    }
}

/// The byte offset of the unit a cluster indexes. Shaping returns clusters
/// only of the units it was given, so every cluster has one.
fn byte_offset(starts: &[usize], cluster: u32) -> usize {
    usize::try_from(cluster)
        .ok()
        .and_then(|index| starts.get(index))
        .copied()
        .unwrap_or_default()
}

fn placeholder_box(
    x: f32,
    y: f32,
    advance: f32,
    units_per_em: f32,
    vertical: bool,
) -> Vec<Segment> {
    let stroke = units_per_em * PLACEHOLDER_STROKE_EM;
    if vertical {
        let half = units_per_em * PLACEHOLDER_MIN_ADVANCE_EM / 2.0;
        let inset = advance * 0.1;
        return hollow_box(
            (x - half, y - advance + inset),
            (x + half, y - inset),
            stroke,
        );
    }
    let inset = advance * 0.1;
    hollow_box(
        (x + inset, y),
        (
            x + advance - inset,
            y + units_per_em * PLACEHOLDER_HEIGHT_EM,
        ),
        stroke,
    )
}

/// Builds a hollow rectangle from `(left, bottom)` to `(right, top)` whose
/// inner contour runs opposite the outer one, so a nonzero fill leaves the
/// middle empty.
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

#[derive(Default)]
struct SegmentPen {
    segments: Vec<Segment>,
}

impl OutlinePen for SegmentPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.segments.push(Segment::Move(x, y));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.segments.push(Segment::Line(x, y));
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.segments.push(Segment::Quad(cx0, cy0, x, y));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.segments.push(Segment::Cubic(cx0, cy0, cx1, cy1, x, y));
    }

    fn close(&mut self) {
        self.segments.push(Segment::Close);
    }
}

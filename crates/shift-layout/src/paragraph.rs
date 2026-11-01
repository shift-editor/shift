//! Splits text into paragraphs and shapes each one into positioned runs.

use shift_font::{GlyphId, OpenTypeCategory};
use shift_shape::{Tag, TextDirection, Unit};
use shift_shaper_font::{ParagraphRequest, ShapedParagraph};

use shift_font::positioning::{
    RunDirection, RunGlyph as PositionedRunGlyph, RunPosition, RunPositioning,
};

use crate::font::{FontReads, GeneratedPositions, LayoutFont, font_units};

/// The tag of the generated kerning feature.
const KERN: Tag = Tag::new(b"kern");
use crate::request::{LayoutUnit, TextOptions};
use crate::{Direction, GlyphBounds};

/// The advance a nonspacing mark of zero width takes when text is laid out
/// as typed, so it stays visible and editable beside its neighbours. Export
/// is unaffected.
pub(crate) const NONSPACING_MARK_EDITOR_ADVANCE: f64 = 600.0;

/// Where a mark laid out as typed puts its attaching anchor, across from
/// the pen position.
const TYPED_MARK_ANCHOR_X: f64 = 300.0;

/// The units between two line breaks.
pub(crate) struct Paragraph {
    /// The first unit's index in the text.
    pub start: u32,
    pub units: Vec<Unit<GlyphId>>,
    /// Whether a line break ends it, the unit after its last.
    pub ends_in_break: bool,
}

impl Paragraph {
    /// Splits `units` at their line breaks; no paragraphs for no units.
    pub(crate) fn split(units: &[LayoutUnit]) -> Vec<Self> {
        if units.is_empty() {
            return Vec::new();
        }
        let mut paragraphs = Vec::new();
        let mut current = Self {
            start: 0,
            units: Vec::new(),
            ends_in_break: false,
        };
        for (index, unit) in (0u32..).zip(units) {
            match unit {
                LayoutUnit::Character { codepoint } => current.units.push(Unit::Character(
                    char::from_u32(*codepoint).unwrap_or(char::REPLACEMENT_CHARACTER),
                )),
                LayoutUnit::Glyph { glyph_id } => current.units.push(Unit::Glyph(*glyph_id)),
                LayoutUnit::LineBreak => {
                    current.ends_in_break = true;
                    let next = Self {
                        start: index + 1,
                        units: Vec::new(),
                        ends_in_break: false,
                    };
                    paragraphs.push(std::mem::replace(&mut current, next));
                }
            }
        }
        paragraphs.push(current);
        paragraphs
    }

    /// One past its last unit, before the line break that ends it.
    pub(crate) fn end(&self) -> u32 {
        self.start + u32::try_from(self.units.len()).unwrap_or(u32::MAX)
    }

    /// Shapes and positions the paragraph, or lays it out as typed when the
    /// options turn shaping off or it cannot be shaped, with why.
    pub(crate) fn shape(
        &self,
        font: &LayoutFont<'_>,
        options: &TextOptions,
    ) -> (ShapedText, Option<String>) {
        if !options.shaping {
            return (self.typed(font), None);
        }
        let (shaper, location) = match font.shaper() {
            Ok(shaping) => shaping,
            Err(reason) => return (self.typed(font), Some(reason.to_string())),
        };
        let features: Vec<shift_shape::FeatureSetting> = options
            .features
            .iter()
            .filter_map(|feature| {
                Some(shift_shape::FeatureSetting {
                    tag: Tag::new_checked(feature.tag.as_bytes()).ok()?,
                    value: feature.value,
                })
            })
            .collect();
        let request = ParagraphRequest {
            units: &self.units,
            location,
            script: options.script.as_deref(),
            language: options.language.as_deref(),
            features: &features,
        };
        let mut positions = GeneratedPositions::new(font);
        let kerned = shaper.runs_generated(KERN, &features);
        match shaper.shape_paragraph_live(&request, font, &mut positions) {
            Ok(shaped) => (self.shaped(font, shaped, &positions, kerned), None),
            Err(error) => (self.typed(font), Some(error.to_string())),
        }
    }

    /// The shaped runs as layout reads them, with unit indices in the text,
    /// each glyph's kerning apart from its advance (when the generated `kern`
    /// ran), and a mark nothing attached shown at its own advance.
    fn shaped(
        &self,
        font: &LayoutFont<'_>,
        shaped: ShapedParagraph,
        positions: &GeneratedPositions<'_, '_>,
        kerned: bool,
    ) -> ShapedText {
        let runs = shaped
            .runs
            .into_iter()
            .map(|run| {
                let mut clusters: Vec<u32> = run.glyphs.iter().map(|glyph| glyph.cluster).collect();
                clusters.sort_unstable();
                clusters.dedup();
                let glyphs: Vec<RunGlyph> = run
                    .glyphs
                    .iter()
                    .map(|glyph| {
                        // A glyph covers the units up to the run's next cluster.
                        let next = clusters.partition_point(|cluster| *cluster <= glyph.cluster);
                        let end = clusters.get(next).copied().unwrap_or(run.units.end);
                        let mut placed = RunGlyph {
                            glyph_id: glyph.glyph_id,
                            start: self.start + glyph.cluster,
                            end: self.start + end,
                            x_advance: f64::from(glyph.x_advance),
                            kern: 0.0,
                            x_offset: f64::from(glyph.x_offset),
                            y_offset: f64::from(glyph.y_offset),
                            is_mark: glyph.is_mark,
                            bounds: glyph.glyph_id.and_then(|glyph| font.bounds(glyph)),
                        };
                        if let Some(glyph_id) = glyph.glyph_id
                            && glyph.is_mark
                            && !positions.attached(glyph.cluster, glyph_id)
                        {
                            placed.x_advance = shown_advance(font.advance(glyph_id));
                        }
                        placed
                    })
                    .collect();
                let mut shaped = ShapedRun {
                    start: self.start + run.units.start,
                    end: self.start + run.units.end,
                    level: u32::from(run.level),
                    direction: run.direction.into(),
                    script: run.script,
                    glyphs,
                };
                if kerned {
                    shaped.separate_kerning(font);
                }
                shaped
            })
            .collect();
        ShapedText {
            direction: shaped.direction.into(),
            runs,
        }
    }

    /// The paragraph as typed: one glyph per unit, left to right, each at
    /// its own advance, with a nonspacing mark set beside the text at the
    /// height its anchor attaches at.
    fn typed(&self, font: &LayoutFont<'_>) -> ShapedText {
        let glyphs = (self.start..)
            .zip(&self.units)
            .map(|(unit, item)| {
                let glyph_id = match item {
                    Unit::Character(character) => font.character_glyph(u32::from(*character)),
                    Unit::Glyph(glyph) => Some(*glyph),
                };
                let mut glyph = RunGlyph {
                    glyph_id,
                    start: unit,
                    end: unit + 1,
                    x_advance: glyph_id.map_or(0.0, |glyph| font.advance(glyph)),
                    kern: 0.0,
                    x_offset: 0.0,
                    y_offset: 0.0,
                    is_mark: false,
                    bounds: glyph_id.and_then(|glyph| font.bounds(glyph)),
                };
                if let Some(glyph_id) = glyph_id
                    && font.class(glyph_id) == Some(OpenTypeCategory::Mark)
                    && glyph.x_advance <= 0.0
                {
                    glyph.x_advance = shown_advance(glyph.x_advance);
                    (glyph.x_offset, glyph.y_offset) =
                        font.typed_mark_offset(glyph_id, glyph.bounds);
                }
                glyph
            })
            .collect();
        ShapedText {
            direction: Direction::Ltr,
            runs: vec![ShapedRun {
                start: self.start,
                end: self.end(),
                level: 0,
                direction: Direction::Ltr,
                script: None,
                glyphs,
            }],
        }
    }
}

/// The advance a mark nothing attached shows at: its own, or a visible
/// stand-in for a nonspacing mark of no width. Export sets such a mark at no
/// advance; the editor shows it so it can be seen and edited.
fn shown_advance(own: f64) -> f64 {
    if own > 0.0 {
        own
    } else {
        NONSPACING_MARK_EDITOR_ADVANCE
    }
}

impl ShapedRun {
    /// Takes the generated kerning out of each glyph's advance into its `kern`,
    /// the space after it on screen: for a right-to-left pair the kerning sits
    /// before its first glyph on screen, so after the glyph left of it.
    fn separate_kerning(&mut self, font: &LayoutFont<'_>) {
        let direction = self.direction;
        let glyphs = &mut self.glyphs;
        let count = glyphs.len();
        // Logical order: a right-to-left run's display order reversed.
        let logical = |index: usize| match direction {
            Direction::Ltr => index,
            Direction::Rtl => count - 1 - index,
        };
        let run: Vec<PositionedRunGlyph> = (0..count)
            .map(|index| {
                let glyph = &glyphs[logical(index)];
                PositionedRunGlyph {
                    glyph_id: glyph.glyph_id,
                    is_mark: glyph.is_mark,
                }
            })
            .collect();
        let mut unused = vec![RunPosition::default(); count];
        let run_direction = RunDirection::from(direction);
        let mut reads = FontReads(font);
        let kerns = RunPositioning::new(&run, &mut unused, run_direction, &mut reads).kerns();
        for (index, kern) in kerns.into_iter().enumerate() {
            // Shaping added the kerning in whole units; the layout reports it
            // as the font blends it.
            let applied = f64::from(font_units(kern));
            if kern == 0.0 {
                continue;
            }
            let shown = logical(index);
            match direction {
                Direction::Ltr => {
                    glyphs[shown].x_advance -= applied;
                    glyphs[shown].kern += kern;
                }
                Direction::Rtl => {
                    let Some(left) = shown.checked_sub(1) else {
                        continue;
                    };
                    glyphs[shown].x_advance -= applied;
                    glyphs[shown].x_offset -= applied;
                    glyphs[left].kern += kern;
                }
            }
        }
    }
}

impl LayoutFont<'_> {
    /// Where a nonspacing mark laid out as typed is drawn from its pen
    /// position: its attaching anchor at the height it attaches at, or its
    /// outline centred between ascender and descender.
    fn typed_mark_offset(&self, mark: GlyphId, bounds: Option<GlyphBounds>) -> (f64, f64) {
        let metrics = self.metrics();
        let middle = f64::midpoint(metrics.ascender, metrics.descender);
        let attaching = self.anchors(mark).and_then(|anchors| {
            anchors
                .anchors
                .iter()
                .find(|anchor| anchor.name.len() > 1 && anchor.name.starts_with('_'))
                .cloned()
        });
        if let Some(anchor) = attaching {
            let height = match &anchor.name[1..] {
                "top" => metrics.cap_height.unwrap_or(metrics.ascender),
                "bottom" | "ogonek" => 0.0,
                _ => middle,
            };
            return (TYPED_MARK_ANCHOR_X - anchor.x, height - anchor.y);
        }
        let Some(bounds) = bounds else {
            return (0.0, 0.0);
        };
        (
            TYPED_MARK_ANCHOR_X - f64::midpoint(bounds.x_min, bounds.x_max),
            middle - f64::midpoint(bounds.y_min, bounds.y_max),
        )
    }
}

/// A paragraph shaped and positioned: its base direction and its runs in
/// logical order.
pub(crate) struct ShapedText {
    pub direction: Direction,
    pub runs: Vec<ShapedRun>,
}

/// One run of a shaped paragraph; its glyphs in display order.
pub(crate) struct ShapedRun {
    pub start: u32,
    pub end: u32,
    pub level: u32,
    pub direction: Direction,
    pub script: Option<String>,
    pub glyphs: Vec<RunGlyph>,
}

/// One positioned glyph of a run, with the units it shows in the text.
#[derive(Clone, Copy)]
pub(crate) struct RunGlyph {
    pub glyph_id: Option<GlyphId>,
    pub start: u32,
    pub end: u32,
    /// Its advance, without kerning.
    pub x_advance: f64,
    /// The kerning after it on screen, before the next glyph.
    pub kern: f64,
    pub x_offset: f64,
    pub y_offset: f64,
    pub is_mark: bool,
    pub bounds: Option<GlyphBounds>,
}

impl From<TextDirection> for Direction {
    fn from(direction: TextDirection) -> Self {
        match direction {
            TextDirection::LeftToRight => Self::Ltr,
            TextDirection::RightToLeft => Self::Rtl,
        }
    }
}

impl From<Direction> for RunDirection {
    fn from(direction: Direction) -> Self {
        match direction {
            Direction::Ltr => Self::LeftToRight,
            Direction::Rtl => Self::RightToLeft,
        }
    }
}

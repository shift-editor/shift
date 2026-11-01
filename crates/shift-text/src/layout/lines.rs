//! Breaks paragraphs into lines, orders each line's runs for display, and
//! places lines and glyphs.

use std::ops::Range;

use crate::shape::{line_breaks, visual_order};

use crate::layout::font::LayoutFont;
use crate::layout::paragraph::{Paragraph, RunGlyph, ShapedText};
use crate::layout::request::{LayoutError, LineHeight, LineMetrics, TextAlign, TextOptions};
use crate::layout::{Direction, LayoutLine, LineRun, PlacedGlyph, TextLayout};

/// How lines are spaced and aligned.
pub(crate) struct Placement<'o> {
    metrics: LineMetrics,
    options: &'o TextOptions,
}

impl<'o> Placement<'o> {
    pub(crate) fn new(font: &LayoutFont<'_>, options: &'o TextOptions) -> Self {
        Self {
            metrics: font.metrics(),
            options,
        }
    }

    /// How far apart baselines are.
    fn line_height(&self) -> f64 {
        match self.options.line_height {
            LineHeight::Auto => {
                self.metrics.ascender - self.metrics.descender + self.metrics.line_gap
            }
            LineHeight::Em { em } => em * self.metrics.units_per_em,
        }
    }

    /// Lays out each paragraph's lines in turn, then aligns them.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError::TooLong`] for more glyphs or lines than a
    /// `u32` names.
    pub(crate) fn place(
        &self,
        paragraphs: &[Paragraph],
        shaped: &[ShapedText],
    ) -> Result<TextLayout, LayoutError> {
        let mut layout = TextLayout {
            line_height: self.line_height(),
            ..TextLayout::default()
        };
        for (number, (paragraph, text)) in (0u32..).zip(paragraphs.iter().zip(shaped)) {
            let ranges = self.break_lines(paragraph, text);
            let last = ranges.len().saturating_sub(1);
            for (index, units) in ranges.into_iter().enumerate() {
                let covers_break = index == last && paragraph.ends_in_break;
                self.place_line(&mut layout, number, units, covers_break, text)?;
            }
        }
        self.align(&mut layout);
        Ok(layout)
    }

    /// The paragraph's lines, as unit ranges in the text: one when there is
    /// no width, otherwise as many as fit, broken where UAX #14 allows.
    fn break_lines(&self, paragraph: &Paragraph, text: &ShapedText) -> Vec<Range<u32>> {
        let start = paragraph.start;
        let end = paragraph.end;
        let Some(width) = self.options.width.filter(|width| *width > 0.0) else {
            return std::iter::once(start..end).collect();
        };
        let mut advances = vec![0.0; paragraph.units.len()];
        for glyph in text.runs.iter().flat_map(|run| &run.glyphs) {
            if let Some(advance) = advances.get_mut(crate::layout::slice_index(glyph.start - start))
            {
                *advance += glyph.x_advance + glyph.kern;
            }
        }
        let breaks = line_breaks(&paragraph.units);
        let mut lines = Vec::new();
        let mut line_start = 0u32;
        let mut filled = 0.0;
        // The last place the line may break, and how full it was there.
        let mut last_break: Option<(u32, f64)> = None;
        let mut next_break = breaks.iter().peekable();
        for (unit, advance) in (0u32..).zip(&advances) {
            while let Some(opportunity) = next_break.next_if(|opportunity| opportunity.unit <= unit)
            {
                if opportunity.unit != unit || unit == line_start {
                    continue;
                }
                if opportunity.mandatory {
                    lines.push(start + line_start..start + unit);
                    line_start = unit;
                    filled = 0.0;
                    last_break = None;
                } else {
                    last_break = Some((unit, filled));
                }
            }
            filled += advance;
            let is_space = matches!(
                paragraph.units.get(crate::layout::slice_index(unit)),
                Some(crate::shape::Unit::Character(character)) if character.is_whitespace()
            );
            if filled <= width || is_space {
                continue;
            }
            if let Some((at, filled_there)) = last_break.take() {
                lines.push(start + line_start..start + at);
                line_start = at;
                filled -= filled_there;
            } else if unit > line_start {
                lines.push(start + line_start..start + unit);
                line_start = unit;
                filled = *advance;
            }
        }
        lines.push(start + line_start..end);
        lines
    }

    /// Places one line's runs in display order, glyphs left to right from
    /// 0; [`Self::align`] moves it into place.
    fn place_line(
        &self,
        layout: &mut TextLayout,
        paragraph: u32,
        units: Range<u32>,
        covers_break: bool,
        text: &ShapedText,
    ) -> Result<(), LayoutError> {
        let line_number = crate::layout::index_count(layout.lines.len())?;
        let baseline = -self.line_height() * f64::from(line_number);
        let segments: Vec<LineRun> = text
            .runs
            .iter()
            .filter_map(|run| {
                let start = run.start.max(units.start);
                let end = run.end.min(units.end);
                (start < end).then(|| LineRun {
                    start,
                    end,
                    level: u32::from(run.level),
                    direction: run.direction,
                    script: run.script.clone(),
                    glyph_start: 0,
                    glyph_end: 0,
                })
            })
            .collect();
        let levels: Vec<u8> = text
            .runs
            .iter()
            .filter(|run| run.start.max(units.start) < run.end.min(units.end))
            .map(|run| run.level)
            .collect();

        let mut pen = 0.0;
        let mut runs = Vec::with_capacity(segments.len());
        for index in visual_order(&levels) {
            let mut segment = segments[index].clone();
            segment.glyph_start = crate::layout::index_count(layout.glyphs.len())?;
            for glyph in text.glyphs_in(&segment) {
                layout.glyphs.push(PlacedGlyph {
                    glyph_id: glyph.glyph_id,
                    start: glyph.start,
                    end: glyph.end,
                    line: line_number,
                    left: pen,
                    baseline,
                    x_offset: glyph.x_offset,
                    y_offset: glyph.y_offset,
                    advance: glyph.x_advance,
                    kern: glyph.kern,
                    direction: segment.direction,
                    is_mark: glyph.is_mark,
                    bounds: glyph.bounds,
                });
                pen += glyph.x_advance + glyph.kern;
            }
            segment.glyph_end = crate::layout::index_count(layout.glyphs.len())?;
            runs.push(segment);
        }

        layout.lines.push(LayoutLine {
            paragraph,
            start: units.start,
            end: units.end + u32::from(covers_break),
            baseline,
            ascent: self.metrics.ascender,
            descent: self.metrics.descender,
            left: 0.0,
            advance: pen,
            direction: text.direction,
            runs,
        });
        Ok(())
    }

    /// Sets the width lines align in, and moves each line and its glyphs
    /// to its place in it.
    fn align(&self, layout: &mut TextLayout) {
        let widest = layout
            .lines
            .iter()
            .map(|line| line.advance)
            .fold(0.0, f64::max);
        layout.width = self.options.width.unwrap_or(widest);
        for line in &mut layout.lines {
            let align = match (
                self.options.align.unwrap_or(TextAlign::Start),
                line.direction,
            ) {
                (TextAlign::Start, Direction::Ltr) | (TextAlign::End, Direction::Rtl) => {
                    TextAlign::Left
                }
                (TextAlign::Start, Direction::Rtl) | (TextAlign::End, Direction::Ltr) => {
                    TextAlign::Right
                }
                (align, _) => align,
            };
            let room = layout.width - line.advance;
            line.left = match align {
                TextAlign::Right => room,
                TextAlign::Center => room / 2.0,
                _ => 0.0,
            };
            for glyph in layout
                .glyphs
                .get_mut(line.glyph_range())
                .into_iter()
                .flatten()
            {
                glyph.left += line.left;
            }
        }
    }
}

impl LayoutLine {
    /// Its glyphs' indices in [`TextLayout::glyphs`]: from its first run's
    /// first glyph up to its last run's end, empty for a line with no runs.
    fn glyph_range(&self) -> Range<usize> {
        let first = self.runs.first().map_or(0, |run| run.glyph_start);
        let last = self.runs.last().map_or(0, |run| run.glyph_end);
        crate::layout::slice_index(first)..crate::layout::slice_index(last)
    }
}

impl ShapedText {
    /// The glyphs one line shows of a run, in display order: those of the
    /// shaped run that holds `segment` whose first unit falls in it. A run
    /// is shaped across the whole paragraph, so a line cut through it shows
    /// only the glyphs that start on its side of the break; a ligature
    /// spanning the break stays on the line its first unit is on.
    fn glyphs_in<'t>(&'t self, segment: &LineRun) -> impl Iterator<Item = &'t RunGlyph> {
        let units = segment.start..segment.end;
        self.runs
            .iter()
            .filter(move |run| run.start <= units.start && units.end <= run.end)
            .flat_map(|run| &run.glyphs)
            .filter(move |glyph| (segment.start..segment.end).contains(&glyph.start))
    }
}

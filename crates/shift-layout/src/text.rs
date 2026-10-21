//! Greedy line breaking over a text run's pre-measured break segments.
//!
//! Text is shaped and measured before layout, by whoever owns live advances
//! and kerning; here lines are only chosen, by arithmetic over segment widths,
//! for whatever width layout offers.

/// A text run cut where lines may break, measured before layout.
///
/// Widths and the line height are in the run's own units (font units for a
/// text run); [`Self::scale`] converts them to scene units.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BreakSegments {
    /// Width of each unbreakable segment, without the space after it.
    pub widths: Vec<f64>,
    /// Width of the space after each segment, kept between segments on one
    /// line and dropped where a line ends. A missing entry is zero.
    pub trailing: Vec<f64>,
    /// Segments after which a line must end (paragraph ends), ascending.
    /// Indices out of order or past the last segment are ignored, and a break
    /// after the last segment adds no empty line.
    pub hard_breaks: Vec<usize>,
    /// Distance between baselines, in the run's units.
    pub line_height: f64,
    /// Scene units per run unit: the node's size over the font's units per em.
    pub scale: f64,
}

/// One line of a text run, as a range of its break segments.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineRange {
    /// The first segment on the line.
    pub start: usize,
    /// One past the last segment on the line.
    pub end: usize,
    /// The line's width without its trailing space, in the run's units.
    pub width: f64,
}

/// How far a line may exceed the offered width, relative to it, and still
/// fit: widths make a round trip through layout's `f32` and back through the
/// scale, so a width measured as the longest line comes back a few ulps off.
const FIT_TOLERANCE: f64 = 1e-5;

impl BreakSegments {
    /// Breaks the run into lines no wider than `available_width`, in the
    /// run's units, greedily.
    ///
    /// Each line takes segments while they fit, counting the space between
    /// them but not the space after the last. A segment wider than the line
    /// gets a line of its own; a hard break ends a line whatever room is
    /// left. Pass [`f64::INFINITY`] to break at hard breaks only.
    ///
    /// Always returns at least one line: a run with no segments has one
    /// empty line, so it is one line tall.
    #[must_use]
    pub fn break_lines(&self, available_width: f64) -> Vec<LineRange> {
        self.lines(available_width).collect()
    }

    /// Lines for `available_width` as [`Self::break_lines`] chooses them,
    /// without collecting them.
    pub(crate) fn lines(&self, available_width: f64) -> Lines<'_> {
        Lines {
            segments: self,
            limit: available_width + available_width.abs() * FIT_TOLERANCE,
            next: 0,
            hard_break: 0,
            started: false,
        }
    }

    fn trailing(&self, segment: usize) -> f64 {
        self.trailing.get(segment).copied().unwrap_or(0.0)
    }
}

/// The lines [`BreakSegments::break_lines`] chooses, one at a time.
pub(crate) struct Lines<'a> {
    segments: &'a BreakSegments,
    /// The offered width with its tolerance.
    limit: f64,
    /// The first segment of the next line.
    next: usize,
    /// The first entry of `hard_breaks` not yet passed.
    hard_break: usize,
    started: bool,
}

impl Lines<'_> {
    /// Whether a line must end after `segment`. Called with ascending
    /// segments, so passed hard breaks are skipped once.
    fn must_break_after(&mut self, segment: usize) -> bool {
        let breaks = &self.segments.hard_breaks;
        while breaks.get(self.hard_break).is_some_and(|&at| at < segment) {
            self.hard_break += 1;
        }
        breaks.get(self.hard_break) == Some(&segment)
    }
}

impl Iterator for Lines<'_> {
    type Item = LineRange;

    fn next(&mut self) -> Option<LineRange> {
        let widths = &self.segments.widths;
        let first = !self.started;
        self.started = true;
        if widths.is_empty() {
            return first.then_some(LineRange {
                start: 0,
                end: 0,
                width: 0.0,
            });
        }

        let start = self.next;
        let mut width = *widths.get(start)?;
        let mut end = start + 1;
        while !self.must_break_after(end - 1) {
            let Some(&segment) = widths.get(end) else {
                break;
            };
            let candidate = width + self.segments.trailing(end - 1) + segment;
            if candidate > self.limit {
                break;
            }
            width = candidate;
            end += 1;
        }
        self.next = end;
        Some(LineRange { start, end, width })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Segments of the given widths, each followed by a space of 1.
    fn words(widths: &[f64]) -> BreakSegments {
        BreakSegments {
            widths: widths.to_vec(),
            trailing: vec![1.0; widths.len()],
            hard_breaks: vec![],
            line_height: 10.0,
            scale: 1.0,
        }
    }

    fn ranges(lines: &[LineRange]) -> Vec<(usize, usize, f64)> {
        lines
            .iter()
            .map(|line| (line.start, line.end, line.width))
            .collect()
    }

    #[test]
    fn segments_fill_a_line_counting_the_spaces_between_them() {
        let lines = words(&[3.0, 3.0, 3.0]).break_lines(7.0);

        assert_eq!(ranges(&lines), [(0, 2, 7.0), (2, 3, 3.0)]);
    }

    #[test]
    fn a_trailing_space_does_not_make_a_line_overflow() {
        // 3 + 1 + 3 = 7 fits in 7; the space after the second segment is
        // dropped at the line end rather than pushing it to 8.
        let lines = words(&[3.0, 3.0, 3.0]).break_lines(7.5);

        assert_eq!(ranges(&lines), [(0, 2, 7.0), (2, 3, 3.0)]);
    }

    #[test]
    fn an_unlimited_width_breaks_only_at_hard_breaks() {
        let segments = BreakSegments {
            hard_breaks: vec![1],
            ..words(&[3.0, 3.0, 3.0, 3.0])
        };

        let lines = segments.break_lines(f64::INFINITY);

        assert_eq!(ranges(&lines), [(0, 2, 7.0), (2, 4, 7.0)]);
    }

    #[test]
    fn a_hard_break_ends_a_line_with_room_left() {
        let segments = BreakSegments {
            hard_breaks: vec![0],
            ..words(&[3.0, 3.0])
        };

        let lines = segments.break_lines(100.0);

        assert_eq!(ranges(&lines), [(0, 1, 3.0), (1, 2, 3.0)]);
    }

    #[test]
    fn a_hard_break_after_the_last_segment_adds_no_line() {
        let segments = BreakSegments {
            hard_breaks: vec![1],
            ..words(&[3.0, 3.0])
        };

        assert_eq!(ranges(&segments.break_lines(100.0)), [(0, 2, 7.0)]);
    }

    #[test]
    fn out_of_range_and_out_of_order_hard_breaks_are_ignored() {
        let segments = BreakSegments {
            hard_breaks: vec![2, 0, 9],
            ..words(&[3.0, 3.0, 3.0, 3.0])
        };

        let lines = segments.break_lines(100.0);

        assert_eq!(ranges(&lines), [(0, 3, 11.0), (3, 4, 3.0)]);
    }

    #[test]
    fn a_segment_wider_than_the_line_gets_a_line_of_its_own() {
        let lines = words(&[3.0, 20.0, 3.0]).break_lines(10.0);

        assert_eq!(ranges(&lines), [(0, 1, 3.0), (1, 2, 20.0), (2, 3, 3.0)]);
    }

    #[test]
    fn a_zero_width_puts_every_segment_on_its_own_line() {
        let lines = words(&[3.0, 4.0]).break_lines(0.0);

        assert_eq!(ranges(&lines), [(0, 1, 3.0), (1, 2, 4.0)]);
    }

    #[test]
    fn empty_text_is_one_empty_line() {
        let lines = words(&[]).break_lines(10.0);

        assert_eq!(ranges(&lines), [(0, 0, 0.0)]);
    }

    #[test]
    fn missing_trailing_widths_count_as_zero() {
        let segments = BreakSegments {
            trailing: vec![],
            ..words(&[3.0, 3.0])
        };

        assert_eq!(ranges(&segments.break_lines(6.0)), [(0, 2, 6.0)]);
    }

    #[test]
    #[expect(
        clippy::cast_possible_truncation,
        reason = "rounds to f32 as layout does"
    )]
    fn a_width_a_few_ulps_short_of_the_line_still_fits() {
        // The longest line's width after a round trip through f32.
        let segments = words(&[0.1, 0.2, 0.3]);
        let natural = segments.break_lines(f64::INFINITY)[0].width;
        let offered = f64::from(natural as f32) - 1e-7;

        assert_eq!(segments.break_lines(offered).len(), 1);
    }
}

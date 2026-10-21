//! Cursive attachment: joining neighbouring glyphs at their `exit` and
//! `entry` anchors, as the `curs` feature export generates does.
//!
//! Export compiles `curs` with fontc, which, like ufo2ft, writes one lookup
//! for glyphs of left-to-right scripts and one, with the `RightToLeft` flag,
//! for every other glyph that has an `entry` or `exit` anchor, both ignoring
//! marks. A shaper then applies them the way [`attach_cursive`] does, so the
//! editor's live text joins exactly as the exported font does without
//! compiling it.

use kurbo::Point;

/// The anchor a glyph is entered at, joining the glyph before it in reading
/// order: fontc reads exactly this name as a cursive entry.
pub const ENTRY_ANCHOR: &str = "entry";

/// The anchor a glyph is left from, joining the glyph after it in reading
/// order: fontc reads exactly this name as a cursive exit.
pub const EXIT_ANCHOR: &str = "exit";

/// Which way a run of text reads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CursiveDirection {
    #[default]
    LeftToRight,
    RightToLeft,
}

/// One glyph of a run, in reading order, as cursive attachment reads it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CursiveGlyph {
    /// Where the glyph is entered, in its own coordinates.
    pub entry: Option<Point>,
    /// Where the glyph is left, in its own coordinates.
    pub exit: Option<Point>,
    /// A mark is passed over: it neither joins nor breaks a chain.
    pub is_mark: bool,
    /// The glyph's position before attachment, in font units.
    pub position: CursivePosition,
}

/// A glyph's advance and offset, before or after cursive attachment.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CursivePosition {
    pub x_advance: f64,
    pub x_offset: f64,
    pub y_offset: f64,
}

/// Joins each glyph to the one before it in reading order wherever the
/// earlier glyph has an `exit` anchor and the later one an `entry`, and
/// returns every glyph's position after.
///
/// # Remarks
///
/// Applies the `curs` lookups export generates as a shaper applies them
/// (OpenType `GPOS` lookup type 3). Along the run, the earlier glyph's
/// advance is cut so the two anchors meet. Across it, each joined glyph is
/// raised or lowered to its neighbour's anchor: in right-to-left text the
/// chain hangs from the last glyph of a word, which stays on the baseline,
/// so Nastaliq steps up from the word's end; in left-to-right text from the
/// first. Marks are passed over, as the generated lookups ignore marks.
///
/// Export puts a glyph in the right-to-left lookup unless its script reads
/// left to right; the run's direction stands in for that here, which agrees
/// wherever a joining glyph's script matches the run it is set in.
///
/// `glyphs` are in reading (logical) order; the result is in the same order.
pub fn attach_cursive(
    glyphs: &[CursiveGlyph],
    direction: CursiveDirection,
) -> Vec<CursivePosition> {
    let mut positions: Vec<CursivePosition> = glyphs.iter().map(|glyph| glyph.position).collect();
    // The glyph each joined glyph hangs from, as an index; a root hangs from none.
    let mut parents: Vec<Option<usize>> = vec![None; glyphs.len()];

    let mut previous: Option<usize> = None;
    for (current, glyph) in glyphs.iter().enumerate() {
        if glyph.is_mark {
            continue;
        }
        let join = previous.and_then(|earlier| {
            let exit = glyphs[earlier].exit?;
            let entry = glyph.entry?;
            Some((earlier, exit, entry))
        });
        previous = Some(current);
        let Some((earlier, exit, entry)) = join else {
            continue;
        };

        meet_along(&mut positions, earlier, current, exit, entry, direction);
        let rise = entry.y - exit.y;
        let (child, parent, y_offset) = match direction {
            // The lookup's RightToLeft flag hangs the earlier glyph from the later one.
            CursiveDirection::RightToLeft => (earlier, current, rise),
            CursiveDirection::LeftToRight => (current, earlier, -rise),
        };
        positions[child].y_offset = y_offset;
        parents[child] = Some(parent);
    }

    let heights: Vec<f64> = (0..positions.len())
        .map(|index| chain_height(&positions, &parents, index))
        .collect();
    for (position, height) in positions.iter_mut().zip(heights) {
        position.y_offset = height;
    }
    positions
}

/// Cuts the advance between two joined glyphs so the earlier one's `exit`
/// meets the later one's `entry`.
fn meet_along(
    positions: &mut [CursivePosition],
    earlier: usize,
    later: usize,
    exit: Point,
    entry: Point,
    direction: CursiveDirection,
) {
    match direction {
        CursiveDirection::LeftToRight => {
            positions[earlier].x_advance = exit.x + positions[earlier].x_offset;
            let shift = entry.x + positions[later].x_offset;
            positions[later].x_advance -= shift;
            positions[later].x_offset -= shift;
        }
        CursiveDirection::RightToLeft => {
            let shift = exit.x + positions[earlier].x_offset;
            positions[earlier].x_advance -= shift;
            positions[earlier].x_offset -= shift;
            positions[later].x_advance = entry.x + positions[later].x_offset;
        }
    }
}

/// Returns a glyph's height after its chain: its own offset from its
/// parent, plus every ancestor's.
fn chain_height(positions: &[CursivePosition], parents: &[Option<usize>], index: usize) -> f64 {
    let mut height = positions[index].y_offset;
    let mut node = parents[index];
    // A chain visits each glyph at most once.
    let mut steps = positions.len();
    while let Some(parent) = node
        && steps > 0
    {
        height += positions[parent].y_offset;
        node = parents[parent];
        steps -= 1;
    }
    height
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joining(entry: Option<(f64, f64)>, exit: Option<(f64, f64)>, advance: f64) -> CursiveGlyph {
        CursiveGlyph {
            entry: entry.map(Point::from),
            exit: exit.map(Point::from),
            is_mark: false,
            position: CursivePosition {
                x_advance: advance,
                ..CursivePosition::default()
            },
        }
    }

    #[test]
    fn a_right_to_left_word_hangs_from_its_last_letter() {
        // Reading order: init, medi, fina; each exit is 200 below the next entry.
        let glyphs = [
            joining(None, Some((0.0, 0.0)), 400.0),
            joining(Some((400.0, 200.0)), Some((0.0, 0.0)), 400.0),
            joining(Some((450.0, 200.0)), None, 450.0),
        ];

        let heights: Vec<f64> = attach_cursive(&glyphs, CursiveDirection::RightToLeft)
            .iter()
            .map(|position| position.y_offset)
            .collect();

        assert_eq!(heights, [400.0, 200.0, 0.0]);
    }

    #[test]
    fn a_left_to_right_chain_hangs_from_its_first_letter() {
        let glyphs = [
            joining(None, Some((500.0, 100.0)), 500.0),
            joining(Some((0.0, 0.0)), None, 500.0),
        ];

        let positions = attach_cursive(&glyphs, CursiveDirection::LeftToRight);

        assert_eq!(positions[0].x_advance, 500.0);
        assert_eq!(positions[0].y_offset, 0.0);
        assert_eq!(positions[1].y_offset, 100.0);
    }

    #[test]
    fn a_left_to_right_chain_adds_up_from_its_first_letter() {
        let glyphs = [
            joining(None, Some((500.0, 100.0)), 500.0),
            joining(Some((0.0, 0.0)), Some((500.0, 100.0)), 500.0),
            joining(Some((0.0, 0.0)), None, 500.0),
        ];

        let heights: Vec<f64> = attach_cursive(&glyphs, CursiveDirection::LeftToRight)
            .iter()
            .map(|position| position.y_offset)
            .collect();

        assert_eq!(heights, [0.0, 100.0, 200.0]);
    }

    #[test]
    fn a_mark_between_two_letters_neither_joins_nor_breaks_them() {
        let mut mark = joining(Some((0.0, 0.0)), Some((0.0, 0.0)), 0.0);
        mark.is_mark = true;
        let glyphs = [
            joining(None, Some((0.0, 0.0)), 400.0),
            mark,
            joining(Some((450.0, 200.0)), None, 450.0),
        ];

        let positions = attach_cursive(&glyphs, CursiveDirection::RightToLeft);

        assert_eq!(positions[1], mark.position);
        assert_eq!(positions[0].y_offset, 200.0);
    }

    #[test]
    fn glyphs_without_matching_anchors_keep_their_positions() {
        let glyphs = [
            joining(None, None, 300.0),
            joining(Some((0.0, 0.0)), None, 300.0),
        ];

        let positions = attach_cursive(&glyphs, CursiveDirection::LeftToRight);

        assert_eq!(positions, glyphs.map(|glyph| glyph.position).to_vec());
    }
}

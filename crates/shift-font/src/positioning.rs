//! Positions shaped text for the features export generates from kerning and
//! anchors (`curs`, `kern`, `mark`, `mkmk`), over the live font.
//!
//! Export compiles these features with fontc; the editor leaves them out of
//! its shaper font, so kerning and anchor edits never recompile it, and
//! applies them here instead, the way a shaper applies the lookups export
//! writes. A run's glyphs are in logical order with the positions shaping
//! gave them so far, in font units; each rule adds what its feature's
//! lookups would.
//!
//! Attached glyphs get their final offsets directly: a shaper keeps a mark's
//! or cursive glyph's offset relative to the glyph it attaches to until it
//! finishes, and these rules have no such chain, so they work out where the
//! attached glyph ends up when they run.

use std::sync::Arc;

use kurbo::{Point, Vec2};

use crate::GlyphId;
use crate::anchor_name::AttachTo;
pub use crate::anchor_name::{ENTRY_ANCHOR, EXIT_ANCHOR};
use crate::anchor_propagation::PropagatedAnchors;

/// A feature export generates from kerning or anchors.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GeneratedFeature {
    /// `curs`: joins glyphs at their `exit` and `entry` anchors.
    Cursive,
    /// `kern`: pair kerning.
    Kern,
    /// `mark`: marks on bases and ligatures.
    Mark,
    /// `mkmk`: marks on marks.
    MarkToMark,
}

impl GeneratedFeature {
    /// The feature with the OpenType tag `tag`, such as `kern`.
    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "curs" => Some(Self::Cursive),
            "kern" => Some(Self::Kern),
            "mark" => Some(Self::Mark),
            "mkmk" => Some(Self::MarkToMark),
            _ => None,
        }
    }
}

/// Which way a run of text reads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RunDirection {
    #[default]
    LeftToRight,
    RightToLeft,
}

/// One glyph of a run, as positioning reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunGlyph {
    /// `None` for a character with no glyph, which nothing attaches to or
    /// kerns with.
    pub glyph_id: Option<GlyphId>,
    /// Whether the font's `GDEF` classes the glyph as a mark: only marks
    /// attach by anchors, and kerning passes over them.
    pub is_mark: bool,
}

/// A glyph's advance and offset, in font units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RunPosition {
    pub x_advance: f64,
    pub y_advance: f64,
    pub x_offset: f64,
    pub y_offset: f64,
}

impl RunPosition {
    fn offset(&self) -> Vec2 {
        Vec2::new(self.x_offset, self.y_offset)
    }
}

/// What positioning reads from the font, at the location the run is laid out
/// at.
pub trait PositioningFont {
    /// The glyph's anchors as export compiles them, with its components'
    /// anchors propagated in; `None` for a glyph the font cannot resolve.
    fn anchors(&mut self, glyph_id: GlyphId) -> Option<Arc<PropagatedAnchors>>;

    /// The kerning between each pair of glyphs, in pair order.
    fn kerning(&mut self, pairs: &[(GlyphId, GlyphId)]) -> Vec<f64>;
}

/// One run being positioned: its glyphs in logical order and their
/// positions so far.
pub struct RunPositioning<'a, F: ?Sized> {
    glyphs: &'a [RunGlyph],
    positions: &'a mut [RunPosition],
    direction: RunDirection,
    font: &'a mut F,
}

impl<'a, F: PositioningFont + ?Sized> RunPositioning<'a, F> {
    /// Positions `glyphs`, whose positions are `positions` one for one, in a
    /// run read in `direction`.
    pub fn new(
        glyphs: &'a [RunGlyph],
        positions: &'a mut [RunPosition],
        direction: RunDirection,
        font: &'a mut F,
    ) -> Self {
        Self {
            glyphs,
            positions,
            direction,
            font,
        }
    }

    /// Applies what `feature`'s generated lookups would.
    ///
    /// Returns the indices of the marks it attached, for `mark` and `mkmk`.
    pub fn apply(&mut self, feature: GeneratedFeature) -> Vec<usize> {
        match feature {
            GeneratedFeature::Cursive => {
                self.join_cursive();
                Vec::new()
            }
            GeneratedFeature::Kern => {
                self.kern();
                Vec::new()
            }
            GeneratedFeature::Mark => self.attach_marks(),
            GeneratedFeature::MarkToMark => self.attach_marks_to_marks(),
        }
    }

    /// Kerns each pair of neighbouring non-marks, the marks between them
    /// passed over, as export's `kern` lookups do. In a right-to-left run the
    /// value moves the first glyph too, as fontc writes right-to-left pairs.
    fn kern(&mut self) {
        let kerns = self.kerns();
        for (position, value) in self.positions.iter_mut().zip(kerns) {
            position.x_advance += value;
            if self.direction == RunDirection::RightToLeft {
                position.x_offset += value;
            }
        }
    }

    /// The kerning each glyph's pair adds after it, in font units: for the
    /// first glyph of each pair of neighbouring non-marks, the marks between
    /// them passed over; 0 for every other glyph.
    ///
    /// Pairs that name a mark directly are not kerned, though fontc writes
    /// them into a lookup of their own.
    // NOTE: so live text and the exported font can disagree on a pair that
    // names a mark: export kerns it, this does not. Revisit if fonts rely on
    // kerning marks.
    pub fn kerns(&mut self) -> Vec<f64> {
        let mut firsts = Vec::new();
        let mut pairs = Vec::new();
        let mut previous: Option<(usize, GlyphId)> = None;
        for (index, glyph) in self.glyphs.iter().enumerate() {
            if glyph.is_mark {
                continue;
            }
            let Some(glyph_id) = glyph.glyph_id else {
                previous = None;
                continue;
            };
            if let Some((first, before)) = previous {
                firsts.push(first);
                pairs.push((before, glyph_id));
            }
            previous = Some((index, glyph_id));
        }
        let mut kerns = vec![0.0; self.glyphs.len()];
        if pairs.is_empty() {
            return kerns;
        }
        for (first, value) in firsts.into_iter().zip(self.font.kerning(&pairs)) {
            kerns[first] = value;
        }
        kerns
    }

    /// Attaches each mark to the base before it, as export's `mark`
    /// lookups do: the mark's `_name` anchor on the base's `name`, or on a
    /// ligature's last `name_N`, since a mark typed after a ligature follows
    /// its last component.
    fn attach_marks(&mut self) -> Vec<usize> {
        let mut attached = Vec::new();
        let mut base: Option<usize> = None;
        for index in 0..self.glyphs.len() {
            if !self.glyphs[index].is_mark {
                base = Some(index);
                continue;
            }
            if let Some(base) = base
                && self.attach(index, base, AttachTo::BaseOrLigature)
            {
                attached.push(index);
            }
        }
        attached
    }

    /// Attaches each mark to the mark before it, as export's `mkmk` lookups
    /// do: to the nearest earlier mark of the same base with the anchor
    /// the mark attaches by.
    fn attach_marks_to_marks(&mut self) -> Vec<usize> {
        let mut attached = Vec::new();
        for index in 0..self.glyphs.len() {
            if !self.glyphs[index].is_mark {
                continue;
            }
            for target in (0..index).rev() {
                if !self.glyphs[target].is_mark {
                    break;
                }
                if self.attach(index, target, AttachTo::Base) {
                    attached.push(index);
                    break;
                }
            }
        }
        attached
    }

    /// Puts the mark at `mark` on the glyph at `target` where their anchors
    /// match, and returns whether they did.
    fn attach(&mut self, mark: usize, target: usize, to: AttachTo) -> bool {
        let (Some(mark_id), Some(target_id)) =
            (self.glyphs[mark].glyph_id, self.glyphs[target].glyph_id)
        else {
            return false;
        };
        let (Some(mark_anchors), Some(target_anchors)) =
            (self.font.anchors(mark_id), self.font.anchors(target_id))
        else {
            return false;
        };
        let Some(attachment) = mark_anchors.attaching(&target_anchors, to) else {
            return false;
        };
        let pen = self.pen_from(target, mark);
        let offset = self.positions[target].offset() + (attachment.target - attachment.mark) - pen;
        self.positions[mark].x_offset = offset.x;
        self.positions[mark].y_offset = offset.y;
        true
    }

    /// How far the glyph at `later`'s origin is from the glyph at
    /// `earlier`'s on screen, by the advances between them.
    fn pen_from(&self, earlier: usize, later: usize) -> Vec2 {
        let advance = |range: std::ops::Range<usize>| -> f64 {
            self.positions[range]
                .iter()
                .map(|position| position.x_advance)
                .sum()
        };
        let x = match self.direction {
            RunDirection::LeftToRight => advance(earlier..later),
            RunDirection::RightToLeft => -advance(earlier + 1..later + 1),
        };
        Vec2::new(x, 0.0)
    }

    /// Joins each glyph to the one before it in reading order wherever the
    /// earlier glyph has an `exit` anchor and the later one an `entry`, as
    /// export's `curs` lookups do.
    ///
    /// Along the run, the earlier glyph's advance is cut so the two anchors
    /// meet. Across it, each joined glyph is raised or lowered to its
    /// neighbour's anchor: in right-to-left text the chain hangs from the
    /// last glyph of a word, which stays on the baseline, so Nastaliq steps
    /// up from the word's end; in left-to-right text from the first. Marks
    /// are passed over, as the generated lookups ignore marks.
    ///
    /// Export puts a glyph in the right-to-left lookup unless its script
    /// reads left to right; the run's direction stands in for that here,
    /// which agrees wherever a joining glyph's script matches the run it is
    /// set in.
    fn join_cursive(&mut self) {
        let joints: Vec<Option<CursiveAnchors>> = self
            .glyphs
            .iter()
            .map(|glyph| {
                let anchors = self.font.anchors(glyph.glyph_id?)?;
                Some(CursiveAnchors::of(&anchors))
            })
            .collect();
        // The glyph each joined glyph hangs from; a root hangs from none.
        let mut parents: Vec<Option<usize>> = vec![None; self.glyphs.len()];
        let mut rises: Vec<f64> = vec![0.0; self.glyphs.len()];

        let mut previous: Option<usize> = None;
        for (current, glyph) in self.glyphs.iter().enumerate() {
            if glyph.is_mark {
                continue;
            }
            let earlier = previous.replace(current);
            let Some(earlier) = earlier else {
                continue;
            };
            let exit = joints[earlier].and_then(|joint| joint.exit);
            let entry = joints[current].and_then(|joint| joint.entry);
            let (Some(exit), Some(entry)) = (exit, entry) else {
                continue;
            };

            self.meet_along(earlier, current, exit, entry);
            let rise = entry.y - exit.y;
            let (child, parent, height) = match self.direction {
                // The lookup's RightToLeft flag hangs the earlier glyph from the later one.
                RunDirection::RightToLeft => (earlier, current, rise),
                RunDirection::LeftToRight => (current, earlier, -rise),
            };
            rises[child] = height;
            parents[child] = Some(parent);
        }

        for index in 0..self.glyphs.len() {
            if parents[index].is_none() {
                continue;
            }
            self.positions[index].y_offset = chain_height(&rises, &parents, index);
        }
    }

    /// Cuts the advance between two joined glyphs so the earlier one's `exit`
    /// meets the later one's `entry`.
    fn meet_along(&mut self, earlier: usize, later: usize, exit: Point, entry: Point) {
        let positions = &mut *self.positions;
        match self.direction {
            RunDirection::LeftToRight => {
                positions[earlier].x_advance = exit.x + positions[earlier].x_offset;
                let shift = entry.x + positions[later].x_offset;
                positions[later].x_advance -= shift;
                positions[later].x_offset -= shift;
            }
            RunDirection::RightToLeft => {
                let shift = exit.x + positions[earlier].x_offset;
                positions[earlier].x_advance -= shift;
                positions[earlier].x_offset -= shift;
                positions[later].x_advance = entry.x + positions[later].x_offset;
            }
        }
    }
}

/// A glyph's cursive anchors.
#[derive(Clone, Copy)]
struct CursiveAnchors {
    entry: Option<Point>,
    exit: Option<Point>,
}

impl CursiveAnchors {
    fn of(anchors: &PropagatedAnchors) -> Self {
        Self {
            entry: anchors.entry(),
            exit: anchors.exit(),
        }
    }
}

/// A joined glyph's height: its own rise from its parent, plus every
/// ancestor's.
fn chain_height(rises: &[f64], parents: &[Option<usize>], index: usize) -> f64 {
    let mut height = rises[index];
    let mut node = parents[index];
    // A chain visits each glyph at most once.
    let mut steps = rises.len();
    while let Some(parent) = node
        && steps > 0
    {
        height += rises[parent];
        node = parents[parent];
        steps -= 1;
    }
    height
}

#[cfg(test)]
mod tests;

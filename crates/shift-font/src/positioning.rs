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
use crate::anchor_propagation::PropagationAnchor;

/// The anchor a glyph is entered at, joining the glyph before it in reading
/// order: fontc reads exactly this name as a cursive entry.
pub const ENTRY_ANCHOR: &str = "entry";

/// The anchor a glyph is left from, joining the glyph after it in reading
/// order: fontc reads exactly this name as a cursive exit.
pub const EXIT_ANCHOR: &str = "exit";

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
    fn anchors(&mut self, glyph_id: GlyphId) -> Option<Arc<[PropagationAnchor]>>;

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
    pub fn apply(&mut self, feature: GeneratedFeature) {
        match feature {
            GeneratedFeature::Cursive => self.join_cursive(),
            GeneratedFeature::Kern => self.kern(),
            GeneratedFeature::Mark => self.attach_marks(),
            GeneratedFeature::MarkToMark => self.attach_marks_to_marks(),
        }
    }

    /// Kerns each pair of neighbours, as export's `kern` lookups do: pairs
    /// of non-marks with the marks between them passed over, and a mark next
    /// to any glyph, as the lookup that kerns marks reads them. In a
    /// right-to-left run the value moves the first glyph too, as fontc
    /// writes right-to-left pairs.
    fn kern(&mut self) {
        let pairs = self.kerning_pairs();
        if pairs.is_empty() {
            return;
        }
        let glyph_pairs: Vec<(GlyphId, GlyphId)> = pairs.iter().map(|pair| pair.glyphs).collect();
        let values = self.font.kerning(&glyph_pairs);
        for (pair, value) in pairs.iter().zip(values) {
            let position = &mut self.positions[pair.first];
            position.x_advance += value;
            if self.direction == RunDirection::RightToLeft {
                position.x_offset += value;
            }
        }
    }

    /// The pairs export's `kern` lookups read, by the first glyph's index.
    fn kerning_pairs(&self) -> Vec<KerningPair> {
        let mut pairs = Vec::new();
        let mut previous_base: Option<(usize, GlyphId)> = None;
        let mut previous: Option<(usize, RunGlyph)> = None;
        for (index, glyph) in self.glyphs.iter().enumerate() {
            let Some(glyph_id) = glyph.glyph_id else {
                previous_base = None;
                previous = None;
                continue;
            };
            if glyph.is_mark {
                if let Some((first, before)) = previous
                    && let Some(before_id) = before.glyph_id
                {
                    pairs.push(KerningPair {
                        first,
                        glyphs: (before_id, glyph_id),
                    });
                }
            } else {
                if let Some((first, before_id)) = previous_base {
                    pairs.push(KerningPair {
                        first,
                        glyphs: (before_id, glyph_id),
                    });
                }
                if let Some((first, before)) = previous
                    && before.is_mark
                    && let Some(before_id) = before.glyph_id
                {
                    pairs.push(KerningPair {
                        first,
                        glyphs: (before_id, glyph_id),
                    });
                }
            }
            if !glyph.is_mark {
                previous_base = Some((index, glyph_id));
            }
            previous = Some((index, *glyph));
        }
        pairs
    }

    /// Attaches each mark to the base before it, as export's `mark`
    /// lookups do: the mark's `_name` anchor on the base's `name`, or on a
    /// ligature's last `name_N`, since a mark typed after a ligature follows
    /// its last component.
    fn attach_marks(&mut self) {
        let mut base: Option<usize> = None;
        for index in 0..self.glyphs.len() {
            if !self.glyphs[index].is_mark {
                base = Some(index);
                continue;
            }
            if let Some(base) = base {
                self.attach(index, base, AnchorTarget::BaseOrLigature);
            }
        }
    }

    /// Attaches each mark to the mark before it, as export's `mkmk` lookups
    /// do: to the nearest earlier mark of the same base with the anchor
    /// the mark attaches by.
    fn attach_marks_to_marks(&mut self) {
        for index in 0..self.glyphs.len() {
            if !self.glyphs[index].is_mark {
                continue;
            }
            for target in (0..index).rev() {
                if !self.glyphs[target].is_mark {
                    break;
                }
                if self.attach(index, target, AnchorTarget::Base) {
                    break;
                }
            }
        }
    }

    /// Puts the mark at `mark` on the glyph at `target` where their anchors
    /// match, and returns whether they did.
    fn attach(&mut self, mark: usize, target: usize, kind: AnchorTarget) -> bool {
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
        let Some((mark_anchor, target_anchor)) =
            matching_anchors(&mark_anchors, &target_anchors, kind)
        else {
            return false;
        };
        let pen = self.pen_from(target, mark);
        let offset = self.positions[target].offset() + (target_anchor - mark_anchor) - pen;
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

/// A pair of neighbours to kern, and the index of the first.
struct KerningPair {
    first: usize,
    glyphs: (GlyphId, GlyphId),
}

/// Which anchors of the glyph a mark attaches to it by.
#[derive(Clone, Copy, PartialEq, Eq)]
enum AnchorTarget {
    /// `name` only, as on a mark another mark stacks on.
    Base,
    /// `name`, or a ligature's last `name_N`.
    BaseOrLigature,
}

/// The first of the mark's `_name` anchors the target has a match for, and
/// that match.
fn matching_anchors(
    mark: &[PropagationAnchor],
    target: &[PropagationAnchor],
    kind: AnchorTarget,
) -> Option<(Vec2, Vec2)> {
    mark.iter().find_map(|mark_anchor| {
        let group = mark_anchor.name.strip_prefix('_')?;
        if group.is_empty() || group.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let target_anchor =
            target
                .iter()
                .find(|anchor| anchor.name == group)
                .or_else(|| match kind {
                    AnchorTarget::Base => None,
                    AnchorTarget::BaseOrLigature => last_ligature_anchor(target, group),
                })?;
        Some((mark_anchor.point(), target_anchor.point()))
    })
}

/// A ligature's anchor for `group` on its last component: the `group_N`
/// with the largest `N`.
fn last_ligature_anchor<'a>(
    anchors: &'a [PropagationAnchor],
    group: &str,
) -> Option<&'a PropagationAnchor> {
    anchors
        .iter()
        .filter_map(|anchor| {
            let index: u32 = anchor
                .name
                .strip_prefix(group)?
                .strip_prefix('_')?
                .parse()
                .ok()?;
            Some((index, anchor))
        })
        .max_by_key(|(index, _)| *index)
        .map(|(_, anchor)| anchor)
}

impl PropagationAnchor {
    /// Where the anchor is, as a vector from the glyph's origin.
    fn point(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }
}

/// A glyph's cursive anchors.
#[derive(Clone, Copy)]
struct CursiveAnchors {
    entry: Option<Point>,
    exit: Option<Point>,
}

impl CursiveAnchors {
    fn of(anchors: &[PropagationAnchor]) -> Self {
        let named = |name: &str| {
            anchors
                .iter()
                .find(|anchor| anchor.name == name)
                .map(|anchor| Point::new(anchor.x, anchor.y))
        };
        Self {
            entry: named(ENTRY_ANCHOR),
            exit: named(EXIT_ANCHOR),
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

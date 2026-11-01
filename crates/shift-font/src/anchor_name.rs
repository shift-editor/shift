//! What an anchor's name says it is, by the naming Glyphs uses and fontc
//! compiles: a mark's attaching anchor, a base's, one on a ligature's
//! component, a ligature caret, or a cursive joint; and the matches the
//! generated `mark`, `mkmk` and ligature caret lookups make between them.

use kurbo::{Point, Vec2};

use crate::anchor_propagation::{PropagatedAnchors, PropagationAnchor};

/// The prefix of a ligature's caret anchors, `caret_1`, `caret_2`, which
/// export compiles into `GDEF` ligature carets.
const CARET_PREFIX: &str = "caret_";

/// The anchor a glyph is entered at, joining the glyph before it in reading
/// order: fontc reads exactly this name as a cursive entry.
pub const ENTRY_ANCHOR: &str = "entry";

/// The anchor a glyph is left from, joining the glyph after it in reading
/// order: fontc reads exactly this name as a cursive exit.
pub const EXIT_ANCHOR: &str = "exit";

/// An anchor's name, read for what it does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnchorName<'a> {
    /// `_top`: a mark attaches by it to a glyph's `top`.
    Mark(&'a str),
    /// `top`: where a mark attaching by `_top` goes.
    Base(&'a str),
    /// `top_2`: where a mark attaching by `_top` goes on a ligature's second
    /// component.
    Ligature(&'a str, u32),
    /// `caret_1`: a ligature caret, after its first component.
    Caret(u32),
    /// `entry`: where the glyph before joins this one.
    Entry,
    /// `exit`: where this glyph joins the one after.
    Exit,
}

impl<'a> AnchorName<'a> {
    /// Reads `name`. A `_` alone or followed only by digits is no mark
    /// anchor; it reads as a base's.
    pub fn parse(name: &'a str) -> Self {
        if name == ENTRY_ANCHOR {
            return Self::Entry;
        }
        if name == EXIT_ANCHOR {
            return Self::Exit;
        }
        if let Some(group) = name.strip_prefix('_')
            && !group.is_empty()
            && !group.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Self::Mark(group);
        }
        if let Some(index) = name
            .strip_prefix(CARET_PREFIX)
            .and_then(|index| index.parse().ok())
        {
            return Self::Caret(index);
        }
        if let Some((group, index)) = name.rsplit_once('_')
            && !group.is_empty()
            && let Ok(index) = index.parse()
        {
            return Self::Ligature(group, index);
        }
        Self::Base(name)
    }
}

/// Which of a glyph's anchors a mark attaches to it by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachTo {
    /// `name` only, as on a mark another mark stacks on.
    Base,
    /// `name`, or a ligature's last `name_N`, since a mark typed after a
    /// ligature follows its last component.
    BaseOrLigature,
}

/// Where a mark attaches to a glyph: the mark's anchor and the glyph's,
/// each from its own origin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Attachment {
    pub mark: Vec2,
    pub target: Vec2,
}

impl PropagationAnchor {
    /// What the anchor's name says it is.
    pub fn name(&self) -> AnchorName<'_> {
        AnchorName::parse(&self.name)
    }

    /// Where the anchor is, as a vector from the glyph's origin.
    pub fn offset(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    /// The anchor as a point in the glyph's coordinates.
    fn point(&self) -> Point {
        Point::new(self.x, self.y)
    }
}

impl PropagatedAnchors {
    /// Where this glyph, a mark, attaches to `target`, as export's `mark`
    /// and `mkmk` lookups match them: the first of its mark anchors `_name`
    /// that `target` has a `name` for, or, with [`AttachTo::BaseOrLigature`],
    /// a last `name_N`.
    pub fn attaching(&self, target: &Self, to: AttachTo) -> Option<Attachment> {
        self.anchors.iter().find_map(|mark| {
            let AnchorName::Mark(group) = mark.name() else {
                return None;
            };
            let on_target = target
                .anchor(AnchorName::Base(group))
                .or_else(|| match to {
                    AttachTo::Base => None,
                    AttachTo::BaseOrLigature => target.last_ligature_anchor(group),
                })?;
            Some(Attachment {
                mark: mark.offset(),
                target: on_target.offset(),
            })
        })
    }

    /// The ligature carets' positions along the advance, in order.
    pub fn carets(&self) -> Vec<f64> {
        let mut carets: Vec<f64> = self
            .anchors
            .iter()
            .filter(|anchor| matches!(anchor.name(), AnchorName::Caret(_)))
            .map(|anchor| anchor.x)
            .collect();
        carets.sort_by(f64::total_cmp);
        carets
    }

    /// The glyph's cursive `entry` anchor, where present.
    pub fn entry(&self) -> Option<Point> {
        self.anchor(AnchorName::Entry).map(PropagationAnchor::point)
    }

    /// The glyph's cursive `exit` anchor, where present.
    pub fn exit(&self) -> Option<Point> {
        self.anchor(AnchorName::Exit).map(PropagationAnchor::point)
    }

    /// The first anchor named `name`.
    fn anchor(&self, name: AnchorName<'_>) -> Option<&PropagationAnchor> {
        self.anchors.iter().find(|anchor| anchor.name() == name)
    }

    /// The anchor for `group` on the ligature's last component: the
    /// `group_N` with the largest `N`.
    fn last_ligature_anchor(&self, group: &str) -> Option<&PropagationAnchor> {
        self.anchors
            .iter()
            .filter_map(|anchor| match anchor.name() {
                AnchorName::Ligature(name, index) if name == group => Some((index, anchor)),
                _ => None,
            })
            .max_by_key(|(index, _)| *index)
            .map(|(_, anchor)| anchor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(name: &str, x: f64) -> PropagationAnchor {
        PropagationAnchor {
            name: name.to_string(),
            x,
            y: 0.0,
        }
    }

    #[test]
    fn names_read_as_what_they_attach() {
        let read = |name| AnchorName::parse(name);

        assert_eq!(read("_top"), AnchorName::Mark("top"));
        assert_eq!(read("top"), AnchorName::Base("top"));
        assert_eq!(read("top_2"), AnchorName::Ligature("top", 2));
        assert_eq!(read("caret_1"), AnchorName::Caret(1));
        assert_eq!(read("entry"), AnchorName::Entry);
        assert_eq!(read("exit"), AnchorName::Exit);
        assert_eq!(read("_"), AnchorName::Base("_"));
        assert_eq!(read("_1"), AnchorName::Base("_1"));
    }

    #[test]
    fn a_mark_attaches_to_a_base_or_a_ligature_s_last_component() {
        let mark = PropagatedAnchors {
            anchors: vec![anchor("_top", 5.0)],
            base_glyph_count: 0,
        };
        let ligature = PropagatedAnchors {
            anchors: vec![anchor("top_1", 100.0), anchor("top_2", 300.0)],
            base_glyph_count: 2,
        };

        let attached = mark.attaching(&ligature, AttachTo::BaseOrLigature);

        assert_eq!(attached.map(|attachment| attachment.target.x), Some(300.0));
        assert_eq!(mark.attaching(&ligature, AttachTo::Base), None);
    }

    #[test]
    fn carets_come_in_order_along_the_advance() {
        let ligature = PropagatedAnchors {
            anchors: vec![
                anchor("caret_2", 400.0),
                anchor("caret_1", 200.0),
                anchor("top", 0.0),
            ],
            base_glyph_count: 3,
        };

        assert_eq!(ligature.carets(), [200.0, 400.0]);
    }
}

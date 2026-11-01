//! Which glyphs feature source names, so a glyph change it cannot see needs
//! no recompile.

use std::collections::HashSet;

use fea_rs::parse::ParseTree;
use fea_rs::{Kind, Node, NodeOrToken};

/// The glyph names a feature source names, and whether it names glyphs some
/// other way.
///
/// A glyph range (`a.sc - z.sc`) or a CID names glyphs by glyph order or by
/// a name pattern rather than by name, so a source with one depends on every
/// glyph's name and place.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FeatureReferences {
    names: HashSet<String>,
    by_order: bool,
}

impl FeatureReferences {
    /// Reads the names `tree` gives: each glyph name, and both sides of a
    /// hyphenated name that might be a range, since which it is depends on
    /// the glyph set.
    pub(crate) fn of(tree: &ParseTree) -> Self {
        let mut references = Self::default();
        references.read(tree.root());
        references
    }

    /// References that may name any glyph, for a source whose names are
    /// unknown.
    pub(crate) fn every_glyph() -> Self {
        Self {
            names: HashSet::new(),
            by_order: true,
        }
    }

    fn read(&mut self, node: &Node) {
        if node.kind() == Kind::GlyphRange {
            self.by_order = true;
        }
        for child in node.iter_children() {
            match child {
                NodeOrToken::Node(node) => self.read(node),
                NodeOrToken::Token(token) => match token.kind {
                    Kind::GlyphName => self.name(token.as_str()),
                    Kind::GlyphNameOrRange => {
                        let text = token.as_str();
                        self.name(text);
                        for part in text.split('-') {
                            self.name(part);
                        }
                    }
                    Kind::Cid => self.by_order = true,
                    _ => {}
                },
            }
        }
    }

    fn name(&mut self, text: &str) {
        let name = text.strip_prefix('\\').unwrap_or(text);
        self.names.insert(name.to_string());
    }

    /// Whether the source may name a glyph called `name`.
    pub(crate) fn names(&self, name: &str) -> bool {
        self.by_order || self.names.contains(name)
    }

    /// Whether the source names glyphs by order or pattern, so any glyph
    /// change may change what it compiles to.
    pub(crate) fn by_order(&self) -> bool {
        self.by_order
    }
}

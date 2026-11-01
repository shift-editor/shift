//! Proof text as people type it, with glyphs picked by name.
//!
//! The syntax is the one Glyphs uses for its edit view: `/` starts a glyph
//! name, which runs to the next space or the end of the text, and that one
//! space ends the name rather than being text (`/a b` is glyph `a`, then
//! `b`; `/a  b` is `a`, a space, then `b`). `//` is a slash, and `\n` a
//! line break. Every other character is itself.
//!
//! [`ProofText`] parses and formats it, and formatting always parses back
//! to the same items.

use std::fmt;

use crate::GlyphName;

/// One item of proof text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProofItem {
    /// A character; the font's Unicode mapping picks its glyph. Never `\n`,
    /// which is a [`ProofItem::LineBreak`].
    Char(char),
    /// A glyph picked by name.
    Glyph(GlyphName),
    /// A line break.
    LineBreak,
}

/// Proof text: characters, glyphs picked by name, and line breaks, in order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProofText {
    items: Vec<ProofItem>,
}

/// Why text or items are not proof text.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProofTextError {
    /// A `/` with no name after it, at the end of the text or before a
    /// space; a slash is written `//`.
    #[error("a / at byte {offset} names no glyph; write // for a slash")]
    MissingName { offset: usize },
    /// A glyph name that cannot be written: it has a space in it, or starts
    /// with `/`, so it would not parse back as one name.
    #[error("the glyph name {0:?} cannot be written as /name")]
    UnwritableName(GlyphName),
    /// A [`ProofItem::Char`] holding `\n`, which is written as a line break.
    #[error("a line break is a line break item, not a character")]
    LineBreakChar,
}

impl ProofText {
    /// Proof text holding `items`.
    ///
    /// # Errors
    ///
    /// Returns [`ProofTextError::UnwritableName`] for a glyph name with a
    /// space or a leading `/`, and [`ProofTextError::LineBreakChar`] for a
    /// `\n` character, since neither would parse back as itself.
    pub fn new(items: Vec<ProofItem>) -> Result<Self, ProofTextError> {
        for item in &items {
            match item {
                ProofItem::Glyph(name) if name.contains(' ') || name.starts_with('/') => {
                    return Err(ProofTextError::UnwritableName(name.clone()));
                }
                ProofItem::Char('\n') => return Err(ProofTextError::LineBreakChar),
                _ => {}
            }
        }
        Ok(Self { items })
    }

    /// Reads proof text.
    ///
    /// # Errors
    ///
    /// Returns [`ProofTextError::MissingName`] for a `/` at the end of the
    /// text or before a space.
    pub fn parse(text: &str) -> Result<Self, ProofTextError> {
        let mut items = Vec::new();
        let mut chars = text.char_indices().peekable();
        while let Some((offset, char)) = chars.next() {
            match char {
                '\n' => items.push(ProofItem::LineBreak),
                '/' => match chars.peek() {
                    Some((_, '/')) => {
                        chars.next();
                        items.push(ProofItem::Char('/'));
                    }
                    None | Some((_, ' ')) => return Err(ProofTextError::MissingName { offset }),
                    Some(_) => {
                        let mut name = String::new();
                        // The space that ends a name is consumed with it.
                        for (_, next) in chars.by_ref() {
                            if next == ' ' {
                                break;
                            }
                            name.push(next);
                        }
                        let name = GlyphName::new(name)
                            .map_err(|_| ProofTextError::MissingName { offset })?;
                        items.push(ProofItem::Glyph(name));
                    }
                },
                other => items.push(ProofItem::Char(other)),
            }
        }
        Ok(Self { items })
    }

    /// The items, in order.
    pub fn items(&self) -> &[ProofItem] {
        &self.items
    }

    /// The items, taken out.
    pub fn into_items(self) -> Vec<ProofItem> {
        self.items
    }
}

impl fmt::Display for ProofText {
    /// Writes the text [`ProofText::parse`] reads back as these items: a
    /// glyph's name ends with a space unless it is the last item.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, item) in self.items.iter().enumerate() {
            match item {
                ProofItem::Char('/') => formatter.write_str("//")?,
                ProofItem::Char(char) => write!(formatter, "{char}")?,
                ProofItem::LineBreak => formatter.write_str("\n")?,
                ProofItem::Glyph(name) => {
                    write!(formatter, "/{name}")?;
                    if index + 1 < self.items.len() {
                        formatter.write_str(" ")?;
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn glyph(name: &str) -> ProofItem {
        ProofItem::Glyph(GlyphName::new(name).expect("a glyph name"))
    }

    fn parsed(text: &str) -> Vec<ProofItem> {
        ProofText::parse(text).expect("proof text").into_items()
    }

    #[test]
    fn a_name_ends_at_a_space_which_it_consumes() {
        assert_eq!(parsed("/a b"), [glyph("a"), ProofItem::Char('b')]);
        assert_eq!(
            parsed("/a  b"),
            [glyph("a"), ProofItem::Char(' '), ProofItem::Char('b')]
        );
        assert_eq!(parsed("/a /b"), [glyph("a"), glyph("b")]);
    }

    #[test]
    fn a_name_runs_to_the_end_of_the_text_through_dots_and_slashes() {
        assert_eq!(parsed("x/a.alt"), [ProofItem::Char('x'), glyph("a.alt")]);
        assert_eq!(parsed("/a/b"), [glyph("a/b")]);
    }

    #[test]
    fn a_doubled_slash_is_a_slash_and_a_newline_a_line_break() {
        assert_eq!(
            parsed("1//2\n3"),
            [
                ProofItem::Char('1'),
                ProofItem::Char('/'),
                ProofItem::Char('2'),
                ProofItem::LineBreak,
                ProofItem::Char('3'),
            ]
        );
    }

    #[test]
    fn a_slash_naming_nothing_is_an_error() {
        assert_eq!(
            ProofText::parse("ab/"),
            Err(ProofTextError::MissingName { offset: 2 })
        );
        assert_eq!(
            ProofText::parse("/ a"),
            Err(ProofTextError::MissingName { offset: 0 })
        );
    }

    #[test]
    fn writes_the_example_back_as_it_was_typed() {
        let text = "1//2 /a.alt b";
        assert_eq!(
            ProofText::parse(text).expect("proof text").to_string(),
            text
        );
    }

    #[test]
    fn refuses_items_that_would_not_parse_back() {
        let spaced = GlyphName::new("a b").expect("a glyph name");
        assert_eq!(
            ProofText::new(vec![ProofItem::Glyph(spaced.clone())]),
            Err(ProofTextError::UnwritableName(spaced))
        );
        assert_eq!(
            ProofText::new(vec![ProofItem::Char('\n')]),
            Err(ProofTextError::LineBreakChar)
        );
    }

    fn item() -> impl Strategy<Value = ProofItem> {
        prop_oneof![
            any::<char>()
                .prop_filter("a line break is its own item", |char| *char != '\n')
                .prop_map(ProofItem::Char),
            prop::sample::select(vec![' ', '/', '.', '\t']).prop_map(ProofItem::Char),
            "[^ /][^ ]{0,8}".prop_map(|name| glyph(&name)),
            "[a-z]{1,3}[./][a-z./]{0,4}".prop_map(|name| glyph(&name)),
            Just(ProofItem::LineBreak),
        ]
    }

    proptest! {
        #[test]
        fn formatting_always_parses_back_to_the_same_items(
            items in prop::collection::vec(item(), 0..12),
        ) {
            let text = ProofText::new(items.clone()).expect("writable items");
            prop_assert_eq!(parsed(&text.to_string()), items);
        }
    }
}

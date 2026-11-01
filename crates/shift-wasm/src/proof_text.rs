//! Proof text, as shift-font's [`ProofText`] parses and formats it: the one
//! reading of `/name` glyph picks every editor caller uses.

use pack::Pack;
use shift_font::{GlyphName, ProofItem, ProofText, ProofTextError};
use wasm_bindgen::prelude::wasm_bindgen;

/// Reads and writes proof text: `shift_font::ProofText`.
#[pack::interface]
pub trait ProofTexts {
    /// The items `text` holds: characters, glyphs picked by `/name`, and
    /// line breaks.
    ///
    /// # Errors
    ///
    /// Returns [`ProofTextFailure::MissingName`] for a `/` that names no glyph.
    fn parse(&self, text: String) -> Result<Vec<ProofTextItem>, ProofTextFailure>;

    /// The text that parses back as `items`.
    ///
    /// # Errors
    ///
    /// Returns [`ProofTextFailure::UnwritableName`] for a glyph name that
    /// cannot be written as `/name`, and [`ProofTextFailure::Unwritable`] for
    /// a character that is not one.
    fn format(&self, items: Vec<ProofTextItem>) -> Result<String, ProofTextFailure>;
}

/// One item of proof text, as it crosses to the editor.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub enum ProofTextItem {
    /// A character, by code point.
    Character { codepoint: u32 },
    /// A glyph picked by name.
    Glyph { name: GlyphName },
    /// A line break.
    LineBreak,
}

/// Why [`ProofTexts`] could not read or write proof text. Each variant
/// carries the error's text as `detail`, which TypeScript's `PackError` ends
/// its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub enum ProofTextFailure {
    /// A `/` names no glyph.
    MissingName { detail: String },
    /// A glyph name cannot be written as `/name`.
    UnwritableName { detail: String },
    /// A code point is no character, or is a line break given as one.
    Unwritable { detail: String },
}

impl From<ProofTextError> for ProofTextFailure {
    fn from(error: ProofTextError) -> Self {
        let detail = error.to_string();
        match error {
            ProofTextError::MissingName { .. } => Self::MissingName { detail },
            ProofTextError::UnwritableName(_) => Self::UnwritableName { detail },
            ProofTextError::LineBreakChar => Self::Unwritable { detail },
        }
    }
}

/// The proof-text rules [`ProofTexts`] calls.
pub struct ProofTextRules;

impl ProofTexts for ProofTextRules {
    fn parse(&self, text: String) -> Result<Vec<ProofTextItem>, ProofTextFailure> {
        let parsed = ProofText::parse(&text)?;
        Ok(parsed
            .into_items()
            .into_iter()
            .map(|item| match item {
                ProofItem::Char(char) => ProofTextItem::Character {
                    codepoint: u32::from(char),
                },
                ProofItem::Glyph(name) => ProofTextItem::Glyph { name },
                ProofItem::LineBreak => ProofTextItem::LineBreak,
            })
            .collect())
    }

    fn format(&self, items: Vec<ProofTextItem>) -> Result<String, ProofTextFailure> {
        let items = items
            .into_iter()
            .map(|item| match item {
                ProofTextItem::Character { codepoint } => char::from_u32(codepoint)
                    .map(ProofItem::Char)
                    .ok_or_else(|| ProofTextFailure::Unwritable {
                        detail: format!("{codepoint:#x} is not a character"),
                    }),
                ProofTextItem::Glyph { name } => Ok(ProofItem::Glyph(name)),
                ProofTextItem::LineBreak => Ok(ProofItem::LineBreak),
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ProofText::new(items)?.to_string())
    }
}

/// Runs one [`ProofTexts`] method for the editor's generated `ProofTexts` class.
#[wasm_bindgen(js_name = proofTextsRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        proof_texts_request(&ProofTextRules, method, input, blobs, names)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_what_it_parses() {
        let rules = ProofTextRules;
        let items = rules.parse("1//2 /a.alt b".into()).expect("proof text");

        assert_eq!(
            rules.format(items).expect("writable items"),
            "1//2 /a.alt b"
        );
        assert!(matches!(
            rules.parse("/".into()),
            Err(ProofTextFailure::MissingName { .. })
        ));
    }
}

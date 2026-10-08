//! Renders proof definitions from Shift fonts.
//!
//! A [`ProofDefinition`] says what to set; [`layout`] shapes it against a
//! compiled [`ProofFont`] into a [`ProofPage`], which renders to SVG or PNG
//! and describes itself as a [`ProofReport`]. Shaping and outlines come from
//! `shift-specimen`, the one shaping path Shift uses for compiled fonts.
//!
//! This is the compiled lane: real `cmap`, kerning, and features as built.
//! Source-level shaping is a separate, later lane.

pub mod definition;
mod font;
mod label;
pub mod layout;
mod render;
pub mod report;

pub use definition::{
    Across, AcrossKeyword, GlyphKeyword, GlyphSelection, PageSettings, ProofDefinition,
    ProofSection,
};
pub use font::ProofFont;
pub use layout::{layout, ProofPage};
pub use render::{render_png, render_svg};
pub use report::ProofReport;

/// Why a proof could not be produced.
#[derive(Debug, thiserror::Error)]
pub enum ProofError {
    #[error("invalid proof definition: {0}")]
    Definition(String),
    #[error("invalid location: {0}")]
    Location(String),
    #[error("failed to load font: {0}")]
    Load(String),
    #[error("failed to compile font for proofing: {0}")]
    Compile(String),
    #[error("failed to render proof: {0}")]
    Render(String),
}

mod render;
mod report;
mod types;

use clap::ValueEnum;

pub use types::GlyphInspection;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum GlyphInspectView {
    Summary,
    Structure,
    Sources,
    Variation,
    Resolved,
}

mod render;
mod report;
mod types;

use clap::ValueEnum;

pub(crate) use report::parse_location;
pub use types::GlyphInspection;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum GlyphInspectView {
    Summary,
    Structure,
    Sources,
    Variation,
    Resolved,
}

mod render;
mod report;
mod types;

use clap::ValueEnum;

pub(crate) use report::parse_location;
pub(crate) use types::GlyphInspection;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub(crate) enum GlyphInspectView {
    Summary,
    Structure,
    Sources,
    Variation,
    Resolved,
}

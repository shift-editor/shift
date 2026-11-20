use std::path::PathBuf;

use clap::{Args, Subcommand, ValueHint};

use shift_font::stroke::{OutlineStrokeStyle, StrokeCap, StrokeJoin};

use super::MutationArgs;

#[derive(Debug, Subcommand)]
pub(crate) enum StrokeCommand {
    /// Destructive outline stroke (A1): replace skeleton contours with filled outlines.
    OutlineStroke(OutlineStrokeArgs),

    /// Closed-contour offset (A1.2).
    OffsetContour(OffsetContourArgs),

    /// Attach non-destructive live stroke metadata (A2.1).
    SetLiveStroke(SetLiveStrokeArgs),

    /// Bake live stroke skeletons to fill contours (A2.2).
    BakeStroke(BakeStrokeArgs),

    /// Print preview outline bounds for live strokes (read-only, no save).
    Preview(StrokePreviewArgs),
}

#[derive(Debug, Args)]
pub(crate) struct StrokeGlyphLayerArgs {
    /// Path to the canonical SQLite .shift document.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Glyph name or full `glyph_` id.
    #[arg(long)]
    pub glyph: String,

    /// Master source name or id; defaults to the default source.
    #[arg(long)]
    pub source: Option<String>,
}

#[derive(Debug, Args)]
pub(crate) struct OutlineStrokeArgs {
    #[command(flatten)]
    pub target: StrokeGlyphLayerArgs,

    /// Stroke width in font units.
    #[arg(long)]
    pub width: f64,

    #[arg(long, default_value = "round", value_parser = clap::value_parser!(StrokeCap))]
    pub cap: StrokeCap,

    #[arg(long, default_value = "round", value_parser = clap::value_parser!(StrokeJoin))]
    pub join: StrokeJoin,

    /// Miter limit when join is miter.
    #[arg(long, default_value_t = OutlineStrokeStyle::DEFAULT_MITER_LIMIT)]
    pub miter_limit: f64,

    /// Where the stroke lies: -1 entirely left of the path direction, 0 centred, 1 entirely right.
    #[arg(long, default_value_t = 0.0, allow_negative_numbers = true)]
    pub position: f64,

    /// Kurbo flattening tolerance in font units.
    #[arg(long, default_value_t = shift_font::stroke::DEFAULT_TOLERANCE)]
    pub tolerance: f64,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct OffsetContourArgs {
    #[command(flatten)]
    pub target: StrokeGlyphLayerArgs,

    /// Signed offset distance in font units: negative to the left of the path direction, positive to the right.
    #[arg(long, allow_negative_numbers = true)]
    pub distance: f64,

    #[arg(long, default_value = "round", value_parser = clap::value_parser!(StrokeJoin))]
    pub join: StrokeJoin,

    #[arg(long, default_value_t = OutlineStrokeStyle::DEFAULT_MITER_LIMIT)]
    pub miter_limit: f64,

    #[arg(long, default_value_t = shift_font::stroke::DEFAULT_TOLERANCE)]
    pub tolerance: f64,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct SetLiveStrokeArgs {
    #[command(flatten)]
    pub target: StrokeGlyphLayerArgs,

    #[arg(long)]
    pub width: f64,

    #[arg(long, default_value = "round", value_parser = clap::value_parser!(StrokeCap))]
    pub cap: StrokeCap,

    #[arg(long, default_value = "round", value_parser = clap::value_parser!(StrokeJoin))]
    pub join: StrokeJoin,

    #[arg(long, default_value_t = OutlineStrokeStyle::DEFAULT_MITER_LIMIT)]
    pub miter_limit: f64,

    /// Where the stroke lies: -1 entirely left of the path direction, 0 centred, 1 entirely right.
    #[arg(long, default_value_t = 0.0, allow_negative_numbers = true)]
    pub position: f64,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct BakeStrokeArgs {
    #[command(flatten)]
    pub target: StrokeGlyphLayerArgs,

    #[arg(long, default_value_t = shift_font::stroke::DEFAULT_TOLERANCE)]
    pub tolerance: f64,

    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Debug, Args)]
pub(crate) struct StrokePreviewArgs {
    #[command(flatten)]
    pub target: StrokeGlyphLayerArgs,

    #[arg(long, default_value_t = shift_font::stroke::DEFAULT_TOLERANCE)]
    pub tolerance: f64,
}

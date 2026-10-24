//! Command-line arguments for `shift proof`.

use std::path::PathBuf;
use std::str::FromStr;

use clap::{Args, ValueEnum, ValueHint};
use shift_proof::{
    AxisValue, FeatureSetting, ImageFormat, LanguageSetting, ProofError, ScriptSetting,
    TextDirection,
};

#[derive(Debug, Args)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "each field is an independent command-line flag"
)]
pub(crate) struct ProofArgs {
    /// Path to a .shift, UFO, Designspace, Glyphs, TTF, or OTF font source.
    #[arg(value_hint = ValueHint::FilePath)]
    pub path: PathBuf,

    /// Path for the proof image; an existing file is replaced.
    #[arg(short, long, value_hint = ValueHint::FilePath)]
    pub output: PathBuf,

    /// Line of text to set; repeat for more lines. `/name` sets a glyph by
    /// name (ended by the next `/` or a space, which is consumed) and `//`
    /// is a slash. Defaults to a proof set, or every glyph with --grid.
    #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
    pub text: Vec<String>,

    /// Set the glyphs of --text (or every glyph) unshaped in a grid of
    /// named cells, one grid per location.
    #[arg(long)]
    pub grid: bool,

    /// External user-space location as TAG=VALUE[,TAG=VALUE]; repeat to set
    /// every line at several locations.
    #[arg(long = "at", alias = "location", value_name = "TAG=VALUE[,TAG=VALUE]")]
    pub at: Vec<UserLocation>,

    /// Also set every named instance of the compiled font.
    #[arg(long)]
    pub instances: bool,

    /// Also set every master of the font source.
    #[arg(long)]
    pub masters: bool,

    /// OpenType features in HarfBuzz syntax, such as ss01,-liga,kern=0;
    /// repeat or comma-separate.
    #[arg(
        long,
        value_name = "FEATURE",
        value_delimiter = ',',
        allow_hyphen_values = true
    )]
    pub features: Vec<FeatureSetting>,

    /// ISO 15924 script tag, such as Latn or arab. Guessed from the text by
    /// default.
    #[arg(long, value_name = "TAG")]
    pub script: Option<ScriptSetting>,

    /// BCP 47 language tag, such as tr or ar-EG; selects localized forms.
    #[arg(long, value_name = "TAG")]
    pub language: Option<LanguageSetting>,

    /// Text direction: ltr, rtl, ttb, or btt. Guessed from the text by
    /// default; vertical text is set in columns.
    #[arg(long, value_name = "DIR")]
    pub direction: Option<TextDirection>,

    /// Sizes in pixels per em; each text line is set at every size. Defaults
    /// to 72 for text; a grid takes a single size and defaults to 48.
    #[arg(long, value_name = "PX", value_delimiter = ',')]
    pub sizes: Vec<f32>,

    /// Draw ascender, cap-height, x-height, baseline, and descender guides
    /// behind the largest-size rows.
    #[arg(long)]
    pub metrics: bool,

    /// Fixed image width in pixels; text wraps at spaces and grids wrap
    /// cells to fit. A grid defaults to 1200.
    #[arg(long, value_name = "PX")]
    pub width: Option<u32>,

    /// Image format; inferred from the output extension when omitted.
    #[arg(long, value_enum)]
    pub format: Option<ProofFormatArg>,

    /// Emit a structured report for scripts and agents.
    #[arg(long)]
    pub json: bool,
}

/// One `--at` value: comma-separated user-space axis settings.
#[derive(Clone, Debug)]
pub(crate) struct UserLocation(pub(crate) Vec<AxisValue>);

impl FromStr for UserLocation {
    type Err = ProofError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        text.split(',')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .map(Self)
    }
}

/// `--format` values.
#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum ProofFormatArg {
    Png,
    Svg,
}

impl From<ProofFormatArg> for ImageFormat {
    fn from(format: ProofFormatArg) -> Self {
        match format {
            ProofFormatArg::Png => Self::Png,
            ProofFormatArg::Svg => Self::Svg,
        }
    }
}

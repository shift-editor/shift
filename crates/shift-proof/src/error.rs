//! Failures a proof can report.

use skrifa::raw::ReadError;
use thiserror::Error;

/// Why a proof could not be shaped, laid out, or rendered.
#[derive(Debug, Error)]
pub enum ProofError {
    /// The bytes are not a readable TrueType or OpenType font.
    #[error("compiled font is unreadable: {0}")]
    UnreadableFont(#[source] ReadError),

    /// The font's table directory reads, but not with the shaper's font
    /// reader.
    #[error("compiled font cannot be read for shaping")]
    UnshapeableFont,

    /// The font's character map is empty, so no text can be set.
    #[error("the font maps no characters, so there is nothing to proof")]
    NoCharacters,

    /// A location coordinate is not written as `TAG=VALUE`.
    #[error("invalid location {setting:?}; expected TAG=VALUE")]
    InvalidLocation { setting: String },

    /// A location coordinate's value is not a finite number.
    #[error("location value {value:?} for axis {tag:?} is not a finite number")]
    InvalidAxisValue { tag: String, value: String },

    /// A location names the same axis twice, or names a blank tag.
    #[error("axis tag {tag:?} is blank or repeated in the location")]
    RepeatedAxis { tag: String },

    /// A location names an axis the font does not have.
    #[error("the compiled font has no {tag:?} axis; available axes: [{available}]")]
    UnknownAxis { tag: String, available: String },

    /// A location value lies outside the axis range in `fvar`.
    #[error("{tag}={value} is outside the axis range {min}..{max}")]
    AxisOutOfRange {
        tag: String,
        value: f32,
        min: f32,
        max: f32,
    },

    /// A feature setting is not in HarfBuzz syntax.
    #[error("invalid feature {text:?}; expected a tag like ss01, -liga, or kern=0")]
    InvalidFeature { text: String },

    /// A script is not an ISO 15924 tag HarfBuzz knows.
    #[error("invalid script {text:?}; expected an ISO 15924 tag like Latn or arab")]
    InvalidScript { text: String },

    /// A language tag is empty or malformed.
    #[error("invalid language {text:?}; expected a BCP 47 tag like tr or ar-EG")]
    InvalidLanguage { text: String },

    /// A direction is not `ltr`, `rtl`, `ttb`, or `btt`.
    #[error("invalid direction {text:?}; expected ltr, rtl, ttb, or btt")]
    InvalidDirection { text: String },

    /// A size is not finite, not positive, or above the largest size.
    #[error("size {size} is out of range; sizes must be greater than 0 and at most {max}")]
    SizeOutOfRange { size: f32, max: f32 },

    /// A grid was given more than one size.
    #[error("a glyph grid is set at one size; pass a single size")]
    MultipleGridSizes,

    /// A fixed page width of zero was requested.
    #[error("the proof width must be greater than 0")]
    ZeroWidth,

    /// The page exceeds what the rasterizer can allocate.
    #[error(
        "a {width}x{height} proof is too large to render; use fewer lines, smaller sizes, or a fixed width"
    )]
    PageTooLarge { width: u32, height: u32 },

    /// The rasterized page could not be encoded as PNG.
    #[error("failed to encode the proof PNG: {0}")]
    EncodePng(#[source] png::EncodingError),
}

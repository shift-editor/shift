use std::{error::Error, fmt};

/// Failure while converting or packing Slug acceleration data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SlugError {
    InvalidBandCount(u32),
    InvalidAlignment(usize),
    NonFiniteCoordinate { command_index: usize },
    DrawingCommandWithoutContour { command_index: usize },
    CloseWithoutContour { command_index: usize },
    CloseWithoutDrawingSegment { command_index: usize },
    CompactIndexOverflow { glyph_index: u32, curve_count: u32 },
    VariableTopologyMismatch { glyph_index: u32 },
    GlyphIndexOutOfRange(u32),
    NonFiniteVariableWeight,
    LengthOverflow,
}

impl fmt::Display for SlugError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBandCount(count) => {
                write!(formatter, "Slug band count must be in 1..=256, got {count}")
            }
            Self::InvalidAlignment(alignment) => write!(
                formatter,
                "Slug section alignment must be a non-zero power of two, got {alignment}"
            ),
            Self::NonFiniteCoordinate { command_index } => write!(
                formatter,
                "outline command {command_index} contains a non-finite coordinate"
            ),
            Self::DrawingCommandWithoutContour { command_index } => write!(
                formatter,
                "outline command {command_index} draws without an active contour"
            ),
            Self::CloseWithoutContour { command_index } => write!(
                formatter,
                "outline command {command_index} closes without an active contour"
            ),
            Self::CloseWithoutDrawingSegment { command_index } => write!(
                formatter,
                "outline command {command_index} closes a contour with no drawing segment"
            ),
            Self::CompactIndexOverflow {
                glyph_index,
                curve_count,
            } => write!(
                formatter,
                "glyph {glyph_index} has {curve_count} curves, exceeding compact u16 indexes"
            ),
            Self::VariableTopologyMismatch { glyph_index } => write!(
                formatter,
                "glyph {glyph_index} has incompatible command topology between variable sources"
            ),
            Self::GlyphIndexOutOfRange(glyph_index) => {
                write!(formatter, "Slug glyph index {glyph_index} is out of range")
            }
            Self::NonFiniteVariableWeight => {
                formatter.write_str("Slug variable source weight must be finite")
            }
            Self::LengthOverflow => formatter.write_str("Slug atlas length exceeds u32 limits"),
        }
    }
}

impl Error for SlugError {}

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
            Self::LengthOverflow => formatter.write_str("Slug atlas length exceeds u32 limits"),
        }
    }
}

impl Error for SlugError {}

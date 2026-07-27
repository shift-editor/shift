//! Packed glyph payload codecs.
//!
//! This crate owns byte framing and strict validation. It intentionally has no
//! dependency on `shift-font`: authored geometry adaptation belongs to the
//! domain/transport boundary, not to the codec.

use std::{error::Error, fmt};

mod layer;

pub use layer::*;

const MAGIC: &[u8; 4] = b"SHFT";
const OUTLINE_KIND: u8 = 0x01;
const OUTLINE_VERSION: u8 = 0x01;
const HEADER_LEN: usize = 16;

/// Maximum command count accepted by the v1 implementation.
pub const MAX_COMMAND_COUNT: usize = 1_000_000;
/// Maximum coordinate count accepted by the v1 implementation.
pub const MAX_COORD_COUNT: usize = 6_000_000;
/// Maximum total payload size accepted by the v1 implementation.
pub const MAX_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;

/// One codec-owned drawing command.
///
/// Encoders accept `OutlineCommand<f64>` and perform the specified finite f64
/// to f32 conversion. Decoded iterators yield `OutlineCommand<f32>` directly
/// from the validated payload.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OutlineCommand<T> {
    Move {
        x: T,
        y: T,
    },
    Line {
        x: T,
        y: T,
    },
    Quad {
        cx: T,
        cy: T,
        x: T,
        y: T,
    },
    Cubic {
        c1x: T,
        c1y: T,
        c2x: T,
        c2y: T,
        x: T,
        y: T,
    },
    Close,
}

impl<T> OutlineCommand<T> {
    fn byte(&self) -> u8 {
        match self {
            Self::Move { .. } => 0,
            Self::Line { .. } => 1,
            Self::Quad { .. } => 2,
            Self::Cubic { .. } => 3,
            Self::Close => 4,
        }
    }

    fn arity(&self) -> usize {
        match self {
            Self::Move { .. } | Self::Line { .. } => 2,
            Self::Quad { .. } => 4,
            Self::Cubic { .. } => 6,
            Self::Close => 0,
        }
    }
}

/// The command-stream rule violated by an encoder or decoder.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommandOrderError {
    DrawingCommandWithoutContour,
    CloseWithoutContour,
    CloseWithoutDrawingSegment,
}

impl fmt::Display for CommandOrderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DrawingCommandWithoutContour => {
                f.write_str("drawing command requires an active contour")
            }
            Self::CloseWithoutContour => f.write_str("close requires an active contour"),
            Self::CloseWithoutDrawingSegment => {
                f.write_str("close requires at least one drawing segment")
            }
        }
    }
}

/// Strict outline codec failure.
#[derive(Debug, Eq, PartialEq)]
pub enum CodecError {
    HeaderTruncated {
        actual: usize,
    },
    WrongMagic,
    UnsupportedPayloadKind(u8),
    UnsupportedVersion(u8),
    UnknownFlags(u16),
    UnknownCommand {
        index: usize,
        command: u8,
    },
    InvalidCommandOrder {
        index: usize,
        reason: CommandOrderError,
    },
    CoordinateCountMismatch {
        expected: usize,
        actual: usize,
    },
    NonZeroPadding {
        offset: usize,
    },
    NonFiniteCoordinate {
        index: usize,
    },
    NonFiniteInputCoordinate {
        index: usize,
    },
    CoordinateOutOfF32Range {
        index: usize,
    },
    LengthOverflow,
    LengthMismatch {
        expected: usize,
        actual: usize,
    },
    LimitExceeded {
        field: &'static str,
        limit: usize,
        actual: usize,
    },
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HeaderTruncated { actual } => {
                write!(
                    f,
                    "outline header is truncated: {actual} of {HEADER_LEN} bytes"
                )
            }
            Self::WrongMagic => f.write_str("wrong glyph-codec magic"),
            Self::UnsupportedPayloadKind(kind) => {
                write!(f, "unsupported glyph-codec payload kind {kind:#04x}")
            }
            Self::UnsupportedVersion(version) => {
                write!(f, "unsupported glyph-outline version {version}")
            }
            Self::UnknownFlags(flags) => write!(f, "unknown glyph-outline flags {flags:#06x}"),
            Self::UnknownCommand { index, command } => {
                write!(f, "unknown outline command {command:#04x} at index {index}")
            }
            Self::InvalidCommandOrder { index, reason } => {
                write!(
                    f,
                    "invalid outline command ordering at index {index}: {reason}"
                )
            }
            Self::CoordinateCountMismatch { expected, actual } => write!(
                f,
                "outline command arity requires {expected} coordinates, header declares {actual}"
            ),
            Self::NonZeroPadding { offset } => {
                write!(f, "non-zero outline alignment padding at byte {offset}")
            }
            Self::NonFiniteCoordinate { index } => {
                write!(f, "non-finite outline coordinate at index {index}")
            }
            Self::NonFiniteInputCoordinate { index } => {
                write!(f, "non-finite input coordinate at index {index}")
            }
            Self::CoordinateOutOfF32Range { index } => {
                write!(
                    f,
                    "input coordinate at index {index} is outside finite f32 range"
                )
            }
            Self::LengthOverflow => f.write_str("outline payload length arithmetic overflowed"),
            Self::LengthMismatch { expected, actual } => write!(
                f,
                "outline payload length mismatch: expected {expected} bytes, got {actual}"
            ),
            Self::LimitExceeded {
                field,
                limit,
                actual,
            } => write!(
                f,
                "outline {field} exceeds implementation limit {limit}: got {actual}"
            ),
        }
    }
}

impl Error for CodecError {}

/// An owned, canonical `shift.glyph-outline.v1` payload.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedGlyphOutline(Vec<u8>);

impl PackedGlyphOutline {
    /// Validates and takes ownership of an existing payload.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, CodecError> {
        decode_outline(&bytes)?;
        Ok(Self(bytes))
    }

    /// Returns the canonical encoded bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Consumes the opaque value and returns its canonical bytes.
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }

    /// Returns a validated, allocation-free view over this payload.
    pub fn view(&self) -> OutlineView<'_> {
        // Construction and decoding are the only ways to create this type.
        decode_outline(&self.0).expect("PackedGlyphOutline invariant violated")
    }
}

/// Incremental canonical encoder used by domain adapters to avoid allocating an
/// intermediate command-object graph.
#[derive(Debug, Default)]
pub struct OutlineEncoder {
    commands: Vec<u8>,
    coordinates: Vec<f32>,
    state: CommandState,
}

impl OutlineEncoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates an encoder with checked capacities.
    pub fn with_capacity(
        command_count: usize,
        coordinate_count: usize,
    ) -> Result<Self, CodecError> {
        check_limit("command count", command_count, MAX_COMMAND_COUNT)?;
        check_limit("coordinate count", coordinate_count, MAX_COORD_COUNT)?;

        Ok(Self {
            commands: Vec::with_capacity(command_count),
            coordinates: Vec::with_capacity(coordinate_count),
            state: CommandState::default(),
        })
    }

    /// Adds one command after validating ordering and every converted coordinate.
    pub fn push(&mut self, command: OutlineCommand<f64>) -> Result<(), CodecError> {
        let command_index = self.commands.len();
        check_limit(
            "command count",
            command_index
                .checked_add(1)
                .ok_or(CodecError::LengthOverflow)?,
            MAX_COMMAND_COUNT,
        )?;
        let mut next_state = self.state;
        validate_order(&mut next_state, command.byte(), command_index)?;

        let coordinate_index = self.coordinates.len();
        let arity = command.arity();
        check_limit(
            "coordinate count",
            coordinate_index
                .checked_add(arity)
                .ok_or(CodecError::LengthOverflow)?,
            MAX_COORD_COUNT,
        )?;

        let mut converted = [0.0_f32; 6];
        let count = match command {
            OutlineCommand::Move { x, y } | OutlineCommand::Line { x, y } => {
                converted[0] = convert_coordinate(x, coordinate_index)?;
                converted[1] = convert_coordinate(y, coordinate_index + 1)?;
                2
            }
            OutlineCommand::Quad { cx, cy, x, y } => {
                for (slot, (value, index)) in converted.iter_mut().zip(
                    [cx, cy, x, y]
                        .into_iter()
                        .zip(coordinate_index..coordinate_index + 4),
                ) {
                    *slot = convert_coordinate(value, index)?;
                }
                4
            }
            OutlineCommand::Cubic {
                c1x,
                c1y,
                c2x,
                c2y,
                x,
                y,
            } => {
                for (slot, (value, index)) in converted.iter_mut().zip(
                    [c1x, c1y, c2x, c2y, x, y]
                        .into_iter()
                        .zip(coordinate_index..coordinate_index + 6),
                ) {
                    *slot = convert_coordinate(value, index)?;
                }
                6
            }
            OutlineCommand::Close => 0,
        };

        self.state = next_state;
        self.commands.push(command.byte());
        self.coordinates.extend_from_slice(&converted[..count]);
        Ok(())
    }

    /// Finishes the payload with canonical zero padding and little-endian f32s.
    pub fn finish(self) -> Result<PackedGlyphOutline, CodecError> {
        let command_count = self.commands.len();
        let coordinate_count = self.coordinates.len();
        let aligned_commands = align4(command_count).ok_or(CodecError::LengthOverflow)?;
        let coordinate_bytes = coordinate_count
            .checked_mul(4)
            .ok_or(CodecError::LengthOverflow)?;
        let total_len = HEADER_LEN
            .checked_add(aligned_commands)
            .and_then(|value| value.checked_add(coordinate_bytes))
            .ok_or(CodecError::LengthOverflow)?;
        check_limit("payload byte length", total_len, MAX_PAYLOAD_BYTES)?;

        let command_count = u32::try_from(command_count).map_err(|_| CodecError::LengthOverflow)?;
        let coordinate_count =
            u32::try_from(coordinate_count).map_err(|_| CodecError::LengthOverflow)?;
        let mut bytes = Vec::with_capacity(total_len);
        bytes.extend_from_slice(MAGIC);
        bytes.push(OUTLINE_KIND);
        bytes.push(OUTLINE_VERSION);
        bytes.extend_from_slice(&0_u16.to_le_bytes());
        bytes.extend_from_slice(&command_count.to_le_bytes());
        bytes.extend_from_slice(&coordinate_count.to_le_bytes());
        bytes.extend_from_slice(&self.commands);
        bytes.resize(HEADER_LEN + aligned_commands, 0);
        for coordinate in self.coordinates {
            bytes.extend_from_slice(&coordinate.to_le_bytes());
        }

        debug_assert_eq!(bytes.len(), total_len);
        Ok(PackedGlyphOutline(bytes))
    }
}

/// Canonically encodes a codec-owned command slice.
pub fn pack_outline(commands: &[OutlineCommand<f64>]) -> Result<PackedGlyphOutline, CodecError> {
    let coordinate_count = commands.iter().try_fold(0_usize, |count, command| {
        count
            .checked_add(command.arity())
            .ok_or(CodecError::LengthOverflow)
    })?;
    let mut encoder = OutlineEncoder::with_capacity(commands.len(), coordinate_count)?;
    for command in commands {
        encoder.push(*command)?;
    }
    encoder.finish()
}

/// A validated, borrowed outline payload view.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OutlineView<'a> {
    bytes: &'a [u8],
    command_count: usize,
    coordinate_count: usize,
    coordinate_offset: usize,
}

impl<'a> OutlineView<'a> {
    pub fn command_count(&self) -> usize {
        self.command_count
    }

    pub fn coordinate_count(&self) -> usize {
        self.coordinate_count
    }

    /// Iterates decoded commands without allocating points or offset tables.
    pub fn commands(&self) -> OutlineCommandIter<'a> {
        OutlineCommandIter {
            bytes: self.bytes,
            command_count: self.command_count,
            command_index: 0,
            coordinate_offset: self.coordinate_offset,
        }
    }

    /// Iterates all coordinates in command-stream order.
    pub fn coordinates(&self) -> CoordinateIter<'a> {
        CoordinateIter {
            bytes: self.bytes,
            offset: self.coordinate_offset,
            remaining: self.coordinate_count,
        }
    }
}

/// Strictly validates one outline buffer and returns an allocation-free view.
pub fn decode_outline(bytes: &[u8]) -> Result<OutlineView<'_>, CodecError> {
    if bytes.len() < HEADER_LEN {
        return Err(CodecError::HeaderTruncated {
            actual: bytes.len(),
        });
    }
    check_limit("payload byte length", bytes.len(), MAX_PAYLOAD_BYTES)?;

    if &bytes[..4] != MAGIC {
        return Err(CodecError::WrongMagic);
    }
    if bytes[4] != OUTLINE_KIND {
        return Err(CodecError::UnsupportedPayloadKind(bytes[4]));
    }
    if bytes[5] != OUTLINE_VERSION {
        return Err(CodecError::UnsupportedVersion(bytes[5]));
    }

    let flags = u16::from_le_bytes([bytes[6], bytes[7]]);
    if flags != 0 {
        return Err(CodecError::UnknownFlags(flags));
    }

    let command_count = read_u32(bytes, 8) as usize;
    let coordinate_count = read_u32(bytes, 12) as usize;
    check_limit("command count", command_count, MAX_COMMAND_COUNT)?;
    check_limit("coordinate count", coordinate_count, MAX_COORD_COUNT)?;

    let aligned_commands = align4(command_count).ok_or(CodecError::LengthOverflow)?;
    let coordinate_bytes = coordinate_count
        .checked_mul(4)
        .ok_or(CodecError::LengthOverflow)?;
    let expected_len = HEADER_LEN
        .checked_add(aligned_commands)
        .and_then(|value| value.checked_add(coordinate_bytes))
        .ok_or(CodecError::LengthOverflow)?;
    check_limit("payload byte length", expected_len, MAX_PAYLOAD_BYTES)?;
    if bytes.len() != expected_len {
        return Err(CodecError::LengthMismatch {
            expected: expected_len,
            actual: bytes.len(),
        });
    }

    let commands_end = HEADER_LEN + command_count;
    let mut state = CommandState::default();
    let mut expected_coordinate_count = 0_usize;
    for (index, command) in bytes[HEADER_LEN..commands_end].iter().copied().enumerate() {
        let arity = command_arity(command).ok_or(CodecError::UnknownCommand { index, command })?;
        validate_order(&mut state, command, index)?;
        expected_coordinate_count = expected_coordinate_count
            .checked_add(arity)
            .ok_or(CodecError::LengthOverflow)?;
    }
    if expected_coordinate_count != coordinate_count {
        return Err(CodecError::CoordinateCountMismatch {
            expected: expected_coordinate_count,
            actual: coordinate_count,
        });
    }

    let coordinate_offset = HEADER_LEN + aligned_commands;
    for (relative_offset, byte) in bytes[commands_end..coordinate_offset]
        .iter()
        .copied()
        .enumerate()
    {
        if byte != 0 {
            return Err(CodecError::NonZeroPadding {
                offset: commands_end + relative_offset,
            });
        }
    }

    for index in 0..coordinate_count {
        let coordinate = read_f32(bytes, coordinate_offset + index * 4);
        if !coordinate.is_finite() {
            return Err(CodecError::NonFiniteCoordinate { index });
        }
    }

    Ok(OutlineView {
        bytes,
        command_count,
        coordinate_count,
        coordinate_offset,
    })
}

/// Iterator over commands in a validated outline view.
pub struct OutlineCommandIter<'a> {
    bytes: &'a [u8],
    command_count: usize,
    command_index: usize,
    coordinate_offset: usize,
}

impl Iterator for OutlineCommandIter<'_> {
    type Item = OutlineCommand<f32>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.command_index >= self.command_count {
            return None;
        }

        let command = self.bytes[HEADER_LEN + self.command_index];
        self.command_index += 1;
        let mut next = || {
            let value = read_f32(self.bytes, self.coordinate_offset);
            self.coordinate_offset += 4;
            value
        };
        Some(match command {
            0 => OutlineCommand::Move {
                x: next(),
                y: next(),
            },
            1 => OutlineCommand::Line {
                x: next(),
                y: next(),
            },
            2 => OutlineCommand::Quad {
                cx: next(),
                cy: next(),
                x: next(),
                y: next(),
            },
            3 => OutlineCommand::Cubic {
                c1x: next(),
                c1y: next(),
                c2x: next(),
                c2y: next(),
                x: next(),
                y: next(),
            },
            4 => OutlineCommand::Close,
            _ => unreachable!("validated command byte"),
        })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.command_count - self.command_index;
        (remaining, Some(remaining))
    }
}

impl ExactSizeIterator for OutlineCommandIter<'_> {}

/// Iterator over f32 coordinates in a validated outline view.
pub struct CoordinateIter<'a> {
    bytes: &'a [u8],
    offset: usize,
    remaining: usize,
}

impl Iterator for CoordinateIter<'_> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }

        let value = read_f32(self.bytes, self.offset);
        self.offset += 4;
        self.remaining -= 1;
        Some(value)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}

impl ExactSizeIterator for CoordinateIter<'_> {}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum CommandState {
    #[default]
    BetweenContours,
    ActiveWithoutSegment,
    ActiveWithSegment,
}

fn validate_order(state: &mut CommandState, command: u8, index: usize) -> Result<(), CodecError> {
    match command {
        0 => *state = CommandState::ActiveWithoutSegment,
        1..=3 => match state {
            CommandState::BetweenContours => {
                return Err(CodecError::InvalidCommandOrder {
                    index,
                    reason: CommandOrderError::DrawingCommandWithoutContour,
                });
            }
            CommandState::ActiveWithoutSegment | CommandState::ActiveWithSegment => {
                *state = CommandState::ActiveWithSegment;
            }
        },
        4 => match state {
            CommandState::BetweenContours => {
                return Err(CodecError::InvalidCommandOrder {
                    index,
                    reason: CommandOrderError::CloseWithoutContour,
                });
            }
            CommandState::ActiveWithoutSegment => {
                return Err(CodecError::InvalidCommandOrder {
                    index,
                    reason: CommandOrderError::CloseWithoutDrawingSegment,
                });
            }
            CommandState::ActiveWithSegment => *state = CommandState::BetweenContours,
        },
        _ => unreachable!("command byte validated before ordering"),
    }

    Ok(())
}

fn command_arity(command: u8) -> Option<usize> {
    match command {
        0 | 1 => Some(2),
        2 => Some(4),
        3 => Some(6),
        4 => Some(0),
        _ => None,
    }
}

fn convert_coordinate(value: f64, index: usize) -> Result<f32, CodecError> {
    if !value.is_finite() {
        return Err(CodecError::NonFiniteInputCoordinate { index });
    }

    let converted = value as f32;
    if !converted.is_finite() {
        return Err(CodecError::CoordinateOutOfF32Range { index });
    }

    Ok(converted)
}

fn check_limit(field: &'static str, actual: usize, limit: usize) -> Result<(), CodecError> {
    if actual > limit {
        return Err(CodecError::LimitExceeded {
            field,
            limit,
            actual,
        });
    }
    Ok(())
}

fn align4(value: usize) -> Option<usize> {
    value.checked_add(3).map(|value| value & !3)
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("fixed width"))
}

fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("fixed width"))
}

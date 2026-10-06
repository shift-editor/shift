//! Checked length and offset arithmetic for Slug buffers.
//!
//! Atlas sections, curve indices, and packed offsets are stored as `u32`.
//! Every overflow while computing them is the single failure
//! [`SlugError::LengthOverflow`]; this module is the one place that failure is
//! constructed. Keep the arithmetic explicit at the call site
//! (`a.checked_add(b).or_overflow()?`) so the overflowing operation stays
//! visible.

use std::num::TryFromIntError;

use crate::SlugError;

/// Turns a failed checked operation into [`SlugError::LengthOverflow`].
///
/// Implemented for the `Option` returned by `checked_*` arithmetic and the
/// `Result` returned by integer `try_from` conversions. Callers whose error
/// type implements `From<SlugError>` can apply `?` directly.
pub trait OrOverflow<T> {
    /// Returns the value, or [`SlugError::LengthOverflow`] when the operation overflowed.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::LengthOverflow`] for `None` or a failed integer conversion.
    fn or_overflow(self) -> Result<T, SlugError>;
}

impl<T> OrOverflow<T> for Option<T> {
    fn or_overflow(self) -> Result<T, SlugError> {
        self.ok_or(SlugError::LengthOverflow)
    }
}

impl<T> OrOverflow<T> for Result<T, TryFromIntError> {
    fn or_overflow(self) -> Result<T, SlugError> {
        self.map_err(|_| SlugError::LengthOverflow)
    }
}

/// Converts a buffer length or offset to the `u32` stored in packed sections.
///
/// # Errors
///
/// Returns [`SlugError::LengthOverflow`] when `value` exceeds `u32::MAX`.
pub fn to_u32(value: usize) -> Result<u32, SlugError> {
    u32::try_from(value).or_overflow()
}

/// Checks that growing a buffer of `current` items by `additional` stays addressable as `u32`.
///
/// # Errors
///
/// Returns [`SlugError::LengthOverflow`] when the total overflows `usize` or exceeds `u32::MAX`.
pub fn ensure_total(current: usize, additional: usize) -> Result<(), SlugError> {
    to_u32(current.checked_add(additional).or_overflow()?).map(|_| ())
}

/// Fails with [`SlugError::LengthOverflow`] unless `value` fits within `limit`.
///
/// For packed fields narrower than `u32`, such as offsets that share a word with flag bits.
///
/// # Errors
///
/// Returns [`SlugError::LengthOverflow`] when `value > limit`.
pub fn within(value: u32, limit: u32) -> Result<u32, SlugError> {
    if value <= limit {
        Ok(value)
    } else {
        Err(SlugError::LengthOverflow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overflowing_arithmetic_and_conversions_report_length_overflow() {
        assert_eq!(
            u32::MAX.checked_add(1).or_overflow(),
            Err(SlugError::LengthOverflow)
        );
        assert_eq!(2_u32.checked_add(3).or_overflow(), Ok(5));
        assert_eq!(
            u16::try_from(70_000_u32).or_overflow(),
            Err(SlugError::LengthOverflow)
        );
        assert_eq!(within(8, 7), Err(SlugError::LengthOverflow));
        assert_eq!(within(7, 7), Ok(7));
    }

    #[cfg(target_pointer_width = "64")]
    #[test]
    fn lengths_beyond_u32_are_rejected() {
        let beyond = u32::MAX as usize + 1;

        assert_eq!(to_u32(beyond), Err(SlugError::LengthOverflow));
        assert_eq!(
            ensure_total(u32::MAX as usize, 1),
            Err(SlugError::LengthOverflow)
        );
        assert_eq!(ensure_total(1, 2), Ok(()));
    }
}

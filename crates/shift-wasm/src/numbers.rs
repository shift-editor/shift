//! Numbers from the editor read as the integers they stand for.

/// Returns `value` as a `u32` when it is a whole number in range.
#[cfg(feature = "engine")]
pub(crate) fn whole(value: f64) -> Option<u32> {
    let in_range = value.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&value);
    // In range and whole, so the conversion is exact.
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "checked whole and within 0..=u32::MAX above"
    )]
    in_range.then_some(value as u32)
}

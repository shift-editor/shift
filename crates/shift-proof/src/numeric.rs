//! Named numeric conversions whose loss is intended.

/// Rounds a pixel length up to a whole pixel count, saturating at the type's
/// bounds; NaN and negatives become 0.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "float-to-integer `as` saturates, which is the wanted clamp"
)]
pub(crate) fn ceil_pixels(value: f32) -> u32 {
    value.ceil() as u32
}

/// Counts how many whole times something fits, saturating at the type's
/// bounds; NaN and negatives become 0.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "float-to-integer `as` saturates, which is the wanted clamp"
)]
pub(crate) fn whole_count(value: f32) -> usize {
    value.floor() as usize
}

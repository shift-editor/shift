//! Named numeric conversions whose loss is intended.

/// Narrows authored `f64` values to the `f32` the GPU buffers store.
///
/// Values outside `f32`'s range become infinite; callers that must reject
/// them check `is_finite` on the result.
#[expect(
    clippy::cast_possible_truncation,
    reason = "GPU buffers store f32; the lost precision is far below a pixel"
)]
pub(crate) fn lossy_f32(value: f64) -> f32 {
    value as f32
}

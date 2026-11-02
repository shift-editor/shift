//! Numbers from the editor: read as the integers they stand for, and source
//! values blended with interpolation weights.

use wasm_bindgen::prelude::*;

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

/// The weighted sum of source values: `interpolation::blend_values`.
///
/// `values` holds each source's values one after another, `lengths[i]`
/// of them for source `i`; a source the editor lacks has length 0. None when
/// there is no source, one has no values, or two differ in length.
#[wasm_bindgen(js_name = blendSourceValues)]
pub fn blend_source_values(weights: &[f64], values: &[f64], lengths: &[u32]) -> Option<Vec<f64>> {
    let mut rest = values;
    let mut sources = Vec::with_capacity(lengths.len());
    for &length in lengths {
        let (source, after) = rest.split_at_checked(usize::try_from(length).ok()?)?;
        sources.push(source);
        rest = after;
    }
    shift_font::interpolation::blend_values(weights, &sources)
}

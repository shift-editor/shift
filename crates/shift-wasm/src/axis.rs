//! An axis's range and positions, and its kind converted, as shift-font's
//! [`AxisKind`] answers them.
//!
//! Every value is in the axis's user space. The calls are stateless: each
//! carries the axis's kind, so nothing is registered.

use shift_font::AxisKind;
use wasm_bindgen::prelude::wasm_bindgen;

/// An axis's range and the positions it allows, as shift-font decides them.
#[pack::interface]
pub trait Axes {
    /// The lowest position: `AxisKind::minimum`, a discrete axis's smallest value.
    fn minimum(&self, kind: AxisKind) -> f64;
    /// The highest position: `AxisKind::maximum`, a discrete axis's largest value.
    fn maximum(&self, kind: AxisKind) -> f64;
    /// Whether the axis has more than one position: `AxisKind::varies`.
    fn varies(&self, kind: AxisKind) -> bool;
    /// Whether `value` is a position the axis allows: `AxisKind::accepts`.
    fn accepts(&self, kind: AxisKind, value: f64) -> bool;
    /// `value` mapped to `-1..=1` around the default: `AxisKind::normalize`.
    fn normalize(&self, kind: AxisKind, value: f64) -> f64;
    /// The same positions as a continuous range: `AxisKind::to_continuous`.
    fn to_continuous(&self, kind: AxisKind) -> AxisKind;
    /// The same positions as discrete values: `AxisKind::to_discrete`.
    fn to_discrete(&self, kind: AxisKind) -> AxisKind;
}

/// The axis rules [`Axes`] calls.
pub struct AxisRules;

impl Axes for AxisRules {
    fn minimum(&self, kind: AxisKind) -> f64 {
        kind.minimum()
    }

    fn maximum(&self, kind: AxisKind) -> f64 {
        kind.maximum()
    }

    fn varies(&self, kind: AxisKind) -> bool {
        kind.varies()
    }

    fn accepts(&self, kind: AxisKind, value: f64) -> bool {
        kind.accepts(value)
    }

    fn normalize(&self, kind: AxisKind, value: f64) -> f64 {
        kind.normalize(value)
    }

    fn to_continuous(&self, kind: AxisKind) -> AxisKind {
        kind.to_continuous()
    }

    fn to_discrete(&self, kind: AxisKind) -> AxisKind {
        kind.to_discrete()
    }
}

/// Runs one [`Axes`] method for the editor's generated `Axes` class.
#[wasm_bindgen(js_name = axesRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        axes_request(&AxisRules, method, input, blobs, names)
    })
}

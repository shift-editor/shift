//! Linked metrics: evaluating metrics keys such as `=n`, `=|`, or
//! `=(n+o)/2` into the sidebearings and widths they link.
//!
//! [`parse`] reads a key's text against the font's glyph names.
//! [`linked_metrics_order`] gathers one source's keys in the order they must
//! be evaluated, and reports the ones that cannot be, such as keys that
//! depend on each other. [`MetricsKeyEvaluator`] computes a key's value from
//! the glyphs it names, as that source draws them.
//!
//! Keys themselves are stored on glyphs and layers ([`crate::MetricsKeys`]).

mod evaluate;
mod measure;
mod order;
mod syntax;

pub use evaluate::MetricsKeyEvaluator;
pub use measure::Metric;
pub use order::{LinkedMetricsOrder, LinkedSide, linked_metrics_order};
pub use syntax::{
    BinaryOp, Expr, Function, KeyBody, KeyScope, Measure, MeasureSide, ParsedMetricsKey, parse,
};

use crate::CoreError;

/// Why a metrics key cannot be read or evaluated.
#[derive(Debug, thiserror::Error)]
pub enum MetricsKeyError {
    /// The text is not a key; the message says where it goes wrong.
    #[error("{0}")]
    Syntax(String),
    #[error("no glyph named `{0}`")]
    UnknownGlyph(String),
    #[error("`{0}` has no outline to measure a sidebearing from")]
    NoOutline(String),
    #[error("`{glyph}` has no outline at height {height}")]
    NothingAtHeight { glyph: String, height: f64 },
    #[error("`{0}` is not drawn in this source")]
    NotDrawn(String),
    #[error("a width has no opposite side to read with `|`")]
    OppositeOfWidth,
    #[error("the key divides by zero")]
    DivisionByZero,
    #[error("offsets on automatic alignment, such as `=+25`, are not evaluated yet")]
    AutoOffset,
    #[error("these keys depend on each other: {}", .0.join(", "))]
    Cycle(Vec<String>),
    #[error(transparent)]
    Font(#[from] CoreError),
}

#[cfg(test)]
mod tests;

//! Evaluating a parsed key against one source of a font.

use super::MetricsKeyError;
use super::measure::{Metric, measure};
use super::syntax::{BinaryOp, Expr, Function, KeyBody, Measure, MeasureSide, ParsedMetricsKey};
use crate::projection::FontProjection;
use crate::{Font, GlyphId, MetricsKeySide, SourceId};

/// The metric `measure` reads for a key on `side`.
///
/// # Errors
///
/// Returns [`MetricsKeyError::OppositeOfWidth`] for `|` in a width key.
pub(super) fn measured_metric(
    side: MetricsKeySide,
    measure: MeasureSide,
) -> Result<Metric, MetricsKeyError> {
    Ok(match (measure, side) {
        (MeasureSide::Left, _)
        | (MeasureSide::Same, MetricsKeySide::Left)
        | (MeasureSide::Opposite, MetricsKeySide::Right) => Metric::LeftSidebearing,
        (MeasureSide::Right, _)
        | (MeasureSide::Same, MetricsKeySide::Right)
        | (MeasureSide::Opposite, MetricsKeySide::Left) => Metric::RightSidebearing,
        (MeasureSide::Width, _) | (MeasureSide::Same, MetricsKeySide::Width) => Metric::Width,
        (MeasureSide::Opposite, MetricsKeySide::Width) => {
            return Err(MetricsKeyError::OppositeOfWidth);
        }
    })
}

/// Evaluates keys in one source, reading other glyphs as that source draws
/// them, components included.
pub struct MetricsKeyEvaluator<'a> {
    font: &'a Font,
    projection: FontProjection<'a>,
}

impl<'a> MetricsKeyEvaluator<'a> {
    /// An evaluator for `source_id`.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::SourceNotFound`] when the font has no such source.
    pub fn new(font: &'a Font, source_id: SourceId) -> Result<Self, MetricsKeyError> {
        let location = font.require_source(source_id)?.location().clone();
        Ok(Self {
            font,
            projection: font.projection(&location),
        })
    }

    /// The value `key` gives `side` of `glyph_id`, rounded to whole units.
    ///
    /// # Errors
    ///
    /// Returns the [`MetricsKeyError`] for a glyph that cannot be measured,
    /// a division by zero, or an automatic-alignment offset.
    pub fn evaluate(
        &mut self,
        glyph_id: GlyphId,
        side: MetricsKeySide,
        key: &ParsedMetricsKey,
    ) -> Result<f64, MetricsKeyError> {
        let KeyBody::Expr(expr) = &key.body else {
            return Err(MetricsKeyError::AutoOffset);
        };
        let value = self.value(glyph_id, side, expr)?;
        Ok(value.round())
    }

    fn value(
        &mut self,
        glyph_id: GlyphId,
        side: MetricsKeySide,
        expr: &Expr,
    ) -> Result<f64, MetricsKeyError> {
        match expr {
            Expr::Number(value) => Ok(*value),
            Expr::Measure(measure) => self.measure(glyph_id, side, measure),
            Expr::Negate(inner) => Ok(-self.value(glyph_id, side, inner)?),
            Expr::Binary { op, left, right } => {
                let left = self.value(glyph_id, side, left)?;
                let right = self.value(glyph_id, side, right)?;
                match op {
                    BinaryOp::Add => Ok(left + right),
                    BinaryOp::Subtract => Ok(left - right),
                    BinaryOp::Multiply => Ok(left * right),
                    BinaryOp::Divide if right == 0.0 => Err(MetricsKeyError::DivisionByZero),
                    BinaryOp::Divide => Ok(left / right),
                }
            }
            Expr::Call { function, args } => {
                let values = args
                    .iter()
                    .map(|arg| self.value(glyph_id, side, arg))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(match function {
                    Function::Min => values.into_iter().fold(f64::INFINITY, f64::min),
                    Function::Max => values.into_iter().fold(f64::NEG_INFINITY, f64::max),
                })
            }
            Expr::Round(inner) => Ok(self.value(glyph_id, side, inner)?.round()),
        }
    }

    fn measure(
        &mut self,
        glyph_id: GlyphId,
        side: MetricsKeySide,
        measure_ref: &Measure,
    ) -> Result<f64, MetricsKeyError> {
        let metric = measured_metric(side, measure_ref.side)?;
        let target = measure_ref.glyph_id(self.font, glyph_id)?;
        let name = self.font.require_glyph(target)?.name().to_owned();
        let resolved = self
            .projection
            .glyph(target)?
            .ok_or_else(|| MetricsKeyError::NotDrawn(name.clone()))?;
        measure(&resolved, &name, metric, measure_ref.at)
    }
}

impl Measure {
    /// The glyph this measures in `font`: the one it names, or `owner`, the
    /// glyph whose key it is in.
    ///
    /// # Errors
    ///
    /// Returns [`MetricsKeyError::UnknownGlyph`] when the font has no glyph
    /// by the name.
    pub(super) fn glyph_id(&self, font: &Font, owner: GlyphId) -> Result<GlyphId, MetricsKeyError> {
        let Some(name) = &self.glyph else {
            return Ok(owner);
        };
        font.glyph_id_by_name(name.as_str())
            .ok_or_else(|| MetricsKeyError::UnknownGlyph(name.to_string()))
    }
}

//! Converting retained-source values, which name axes and sources by their
//! position in the source, into wire values that name them by the ids a
//! [`SourceIdentity`] gave them.

use crate::bridge::SourceIdentity;
use crate::errors::BridgeResult;
use shift_backends::{AxisIndex, GlyphDelta, GlyphVariation, SourceIndex, VariationSupport};
use shift_font::{AxisId, SourceId};
use shift_wire::{
  GlyphVariation as WireGlyphVariation, InterpolationSupport, VariationBasis, VariationDelta,
};

/// A retained-source value whose wire form needs the source's entity ids.
pub(crate) trait Resolve {
  type Output;

  /// Returns the wire form of `self`, naming entities with `ids`.
  ///
  /// # Errors
  ///
  /// Returns [`crate::errors::BridgeError::InvalidInput`] when `self` names an
  /// axis or source index outside the retained source.
  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<Self::Output>;
}

impl<T: Resolve> Resolve for [T] {
  type Output = Vec<T::Output>;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<Self::Output> {
    self.iter().map(|item| item.resolve(ids)).collect()
  }
}

impl<T: Resolve> Resolve for Option<T> {
  type Output = Option<T::Output>;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<Self::Output> {
    self.as_ref().map(|value| value.resolve(ids)).transpose()
  }
}

impl Resolve for AxisIndex {
  type Output = AxisId;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<AxisId> {
    ids.axis_id(*self)
  }
}

impl Resolve for SourceIndex {
  type Output = SourceId;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<SourceId> {
    ids.source_id(*self)
  }
}

impl Resolve for VariationSupport {
  type Output = InterpolationSupport;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<InterpolationSupport> {
    Ok(InterpolationSupport {
      axis_id: self.axis.resolve(ids)?,
      lower: self.lower,
      peak: self.peak,
      upper: self.upper,
    })
  }
}

impl Resolve for GlyphDelta {
  type Output = VariationDelta;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<VariationDelta> {
    Ok(VariationDelta {
      region: self.region.supports.resolve(ids)?,
      values: self.values.to_vec(),
    })
  }
}

impl Resolve for GlyphVariation {
  type Output = WireGlyphVariation;

  fn resolve(&self, ids: &SourceIdentity) -> BridgeResult<WireGlyphVariation> {
    Ok(WireGlyphVariation {
      basis: VariationBasis {
        deltas: self.deltas.resolve(ids)?,
      },
    })
  }
}

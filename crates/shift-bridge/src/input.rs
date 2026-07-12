use std::str::FromStr;

use shift_font::{
  AnchorId, AxisId, AxisMappingId, ComponentId, ContourId, GlyphId, GuidelineId, LayerId, PointId,
  SourceId,
};

use crate::errors::{BridgeError, BridgeResult};

pub trait BridgeParse: Sized + FromStr {
  const KIND: &'static str;

  fn parse_bridge(value: &str) -> BridgeResult<Self> {
    value.parse().map_err(|_| BridgeError::InvalidInput {
      kind: Self::KIND,
      value: value.to_string(),
    })
  }
}

pub fn parse<T: BridgeParse>(value: &str) -> BridgeResult<T> {
  T::parse_bridge(value)
}

impl BridgeParse for ContourId {
  const KIND: &'static str = "contour ID";
}

impl BridgeParse for GlyphId {
  const KIND: &'static str = "glyph ID";
}

impl BridgeParse for PointId {
  const KIND: &'static str = "point ID";
}

impl BridgeParse for AnchorId {
  const KIND: &'static str = "anchor ID";
}

impl BridgeParse for AxisId {
  const KIND: &'static str = "axis ID";
}

impl BridgeParse for AxisMappingId {
  const KIND: &'static str = "axis mapping ID";
}

impl BridgeParse for ComponentId {
  const KIND: &'static str = "component ID";
}

impl BridgeParse for GuidelineId {
  const KIND: &'static str = "guideline ID";
}

impl BridgeParse for LayerId {
  const KIND: &'static str = "layer ID";
}

impl BridgeParse for SourceId {
  const KIND: &'static str = "source ID";
}

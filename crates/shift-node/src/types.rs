use napi_derive::napi;
use shift_core::{
  font::{FontMetadata, Metrics},
  point::PointType,
};

#[napi(object)]
pub struct JSFontMetrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub cap_height: f64,
  pub x_height: f64,
}

impl From<Metrics> for JSFontMetrics {
  fn from(metrics: Metrics) -> Self {
    Self {
      units_per_em: metrics.units_per_em,
      ascender: metrics.ascender,
      descender: metrics.descender,
      cap_height: metrics.cap_height,
      x_height: metrics.x_height,
    }
  }
}

#[napi(object)]
pub struct JSFontMetaData {
  pub family: String,
  pub style_name: String,
  pub version: i32,
}

impl From<FontMetadata> for JSFontMetaData {
  fn from(metadata: FontMetadata) -> Self {
    Self {
      family: metadata.family,
      style_name: metadata.style_name,
      version: metadata.version,
    }
  }
}

#[napi]
pub enum PointTypeJS {
  OnCurve,
  OffCurve,
}

impl From<PointType> for PointTypeJS {
  fn from(point_type: PointType) -> Self {
    match point_type {
      PointType::OnCurve => PointTypeJS::OnCurve,
      PointType::OffCurve => PointTypeJS::OffCurve,
    }
  }
}

impl From<PointTypeJS> for PointType {
  fn from(point_type: PointTypeJS) -> Self {
    match point_type {
      PointTypeJS::OnCurve => PointType::OnCurve,
      PointTypeJS::OffCurve => PointType::OffCurve,
    }
  }
}

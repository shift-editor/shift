use napi_derive::napi;
use shift_core::{FontMetadata, FontMetrics, PointType};

#[napi(object)]
pub struct JSFontMetrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub cap_height: Option<f64>,
  pub x_height: Option<f64>,
}

impl From<&FontMetrics> for JSFontMetrics {
  fn from(metrics: &FontMetrics) -> Self {
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
  pub family_name: Option<String>,
  pub style_name: Option<String>,
  pub version_major: Option<i32>,
  pub version_minor: Option<i32>,
}

impl From<&FontMetadata> for JSFontMetaData {
  fn from(metadata: &FontMetadata) -> Self {
    Self {
      family_name: metadata.family_name.clone(),
      style_name: metadata.style_name.clone(),
      version_major: metadata.version_major,
      version_minor: metadata.version_minor,
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
      PointType::OnCurve | PointType::QCurve => PointTypeJS::OnCurve,
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

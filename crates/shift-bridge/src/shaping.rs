use napi_derive::napi;

/// The compiled shaping tables and what the editor needs to shape with them
/// itself: shaper glyph order and axis normalization.
#[napi(object)]
pub struct NapiShaperFont {
  /// Changes exactly when the tables do.
  pub revision: u32,
  /// The shaper font: `GSUB`, `GPOS`, `GDEF`, `head`, and `fvar`, with no
  /// outlines, `cmap`, or `hmtx`.
  #[napi(ts_type = "Uint8Array")]
  pub bytes: napi::bindgen_prelude::Buffer,
  /// The Shift glyph at each shaper glyph id; null for a `.notdef` the font
  /// does not have.
  #[napi(ts_type = "Array<GlyphId | null>")]
  pub glyph_ids: Vec<Option<String>>,
  /// Each `fvar` axis, in order, with how its user coordinates normalize.
  pub axes: Vec<NapiShaperAxis>,
}

/// How one axis's user coordinates normalize: linear between mapping
/// points, clamped outside them.
#[napi(object)]
pub struct NapiShaperAxis {
  #[napi(ts_type = "AxisId")]
  pub axis_id: String,
  /// User coordinate at each mapping point, increasing.
  pub user: Vec<f64>,
  /// Normalized coordinate at each mapping point.
  pub normalized: Vec<f64>,
}

impl NapiShaperFont {
  pub(crate) fn new(revision: u64, font: &shift_backends::shaper_font::ShaperFont) -> Self {
    Self {
      revision: u32::try_from(revision).unwrap_or(u32::MAX),
      bytes: font.bytes().to_vec().into(),
      glyph_ids: font
        .glyph_ids()
        .iter()
        .map(|glyph_id| glyph_id.as_ref().map(ToString::to_string))
        .collect(),
      axes: font
        .axis_normalizations()
        .into_iter()
        .map(|(axis_id, normalization)| NapiShaperAxis::new(axis_id, normalization.points()))
        .collect(),
    }
  }
}

impl NapiShaperAxis {
  /// The axis's normalization from its `(user, normalized)` mapping points.
  fn new(axis_id: shift_font::AxisId, points: &[(f64, f64)]) -> Self {
    let (user, normalized) = points.iter().copied().unzip();
    Self {
      axis_id: axis_id.to_string(),
      user,
      normalized,
    }
  }
}

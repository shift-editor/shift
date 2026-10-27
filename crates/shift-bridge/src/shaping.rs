use napi_derive::napi;
use shift_wire::intents;

/// One unit of text to shape: exactly one of a character or a glyph inserted
/// by name.
///
/// No bridge call takes it; it declares the type the editor's WebAssembly
/// shaper takes.
#[napi(object)]
#[expect(unreachable_pub, reason = "declares a TypeScript type only")]
pub struct NapiShapeUnit {
  /// A Unicode scalar value.
  pub codepoint: Option<u32>,
  /// A glyph with no character to type, shaped as itself.
  #[napi(ts_type = "GlyphId")]
  pub glyph_id: Option<String>,
}

#[napi(object)]
#[expect(unreachable_pub, reason = "declares a TypeScript type only")]
pub struct NapiFeatureSetting {
  /// A feature tag such as `liga`.
  pub tag: String,
  /// `0` turns the feature off, `1` on; larger values pick an alternate.
  pub value: u32,
}

/// A paragraph to shape, split into runs of one script.
///
/// No bridge call takes it; it declares the type the editor's WebAssembly
/// shaper takes.
#[napi(object)]
#[expect(dead_code, unreachable_pub, reason = "declares a TypeScript type only")]
pub struct NapiParagraphRequest {
  pub units: Vec<NapiShapeUnit>,
  /// User-space location to shape at; omitted axes are at their default.
  pub location: intents::Location,
  /// BCP 47 language tag; the default language system when omitted.
  pub language: Option<String>,
  /// Settings over the features applied by default.
  pub features: Option<Vec<NapiFeatureSetting>>,
}

/// One shaped glyph. Advances and offsets hold only what the font's feature
/// code positions; glyph advances, kerning, and mark attachment are the
/// caller's to add.
#[napi(object)]
#[expect(unreachable_pub, reason = "declares a TypeScript type only")]
pub struct NapiShapedGlyph {
  /// Absent when a character has no glyph.
  #[napi(ts_type = "GlyphId")]
  pub glyph_id: Option<String>,
  /// Index of the first unit the glyph came from.
  pub cluster: u32,
  pub x_advance: i32,
  pub y_advance: i32,
  pub x_offset: i32,
  pub y_offset: i32,
}

/// One run of a shaped paragraph, in one script and direction.
///
/// No bridge call returns it; it declares the type the editor's WebAssembly
/// shaper returns.
#[napi(object)]
#[expect(dead_code, unreachable_pub, reason = "declares a TypeScript type only")]
pub struct NapiShapedRun {
  /// First paragraph unit in the run.
  pub start: u32,
  /// One past the last paragraph unit in the run.
  pub end: u32,
  /// ISO 15924 script tag such as `Arab`; absent when the run holds only
  /// characters common to all scripts.
  pub script: Option<String>,
  #[napi(ts_type = "\"ltr\" | \"rtl\"")]
  pub direction: String,
  /// Glyphs in visual order; clusters index the paragraph's units.
  pub glyphs: Vec<NapiShapedGlyph>,
}

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

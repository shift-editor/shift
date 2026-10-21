use napi_derive::napi;
use shift_backends::shaper_font::{
  FeatureSetting, ParagraphRequest, ShapeUnit, ShapedGlyph, ShapedRun, TextDirection,
};
use shift_font::{ExternalLocation, GlyphId};
use shift_wire::bridges::napi::NapiLocation;

use crate::bridge::IntoDomain;
use crate::errors::{BridgeError, BridgeResult};
use crate::input::parse;

/// One unit of text to shape: exactly one of a character or a glyph inserted
/// by name.
#[napi(object)]
pub struct NapiShapeUnit {
  /// A Unicode scalar value.
  pub codepoint: Option<u32>,
  /// A glyph with no character to type, shaped as itself.
  #[napi(ts_type = "GlyphId")]
  pub glyph_id: Option<String>,
}

#[napi(object)]
pub struct NapiFeatureSetting {
  /// A feature tag such as `liga`.
  pub tag: String,
  /// `0` turns the feature off, `1` on; larger values pick an alternate.
  pub value: u32,
}

/// A paragraph to shape, split into runs of one script.
#[napi(object)]
pub struct NapiParagraphRequest {
  pub units: Vec<NapiShapeUnit>,
  /// User-space location to shape at; omitted axes are at their default.
  pub location: NapiLocation,
  /// BCP 47 language tag; the default language system when omitted.
  pub language: Option<String>,
  /// Settings over the features applied by default.
  pub features: Option<Vec<NapiFeatureSetting>>,
}

/// One shaped glyph. Advances and offsets hold only what the font's feature
/// code positions; glyph advances, kerning, and mark attachment are the
/// caller's to add.
#[napi(object)]
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

impl From<ShapedGlyph> for NapiShapedGlyph {
  fn from(glyph: ShapedGlyph) -> Self {
    Self {
      glyph_id: glyph.glyph_id.map(|id| id.to_string()),
      cluster: glyph.cluster,
      x_advance: glyph.x_advance,
      y_advance: glyph.y_advance,
      x_offset: glyph.x_offset,
      y_offset: glyph.y_offset,
    }
  }
}

/// One run of a shaped paragraph, in one script and direction.
#[napi(object)]
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

impl From<ShapedRun> for NapiShapedRun {
  fn from(run: ShapedRun) -> Self {
    let direction = match run.direction {
      TextDirection::LeftToRight => "ltr",
      TextDirection::RightToLeft => "rtl",
    };
    Self {
      start: run.units.start,
      end: run.units.end,
      script: run.script,
      direction: direction.to_string(),
      glyphs: run.glyphs.into_iter().map(NapiShapedGlyph::from).collect(),
    }
  }
}

/// A [`NapiParagraphRequest`] with its inputs parsed into the types the
/// shaper takes.
pub(crate) struct ParsedParagraphRequest {
  units: Vec<ShapeUnit>,
  location: ExternalLocation,
  language: Option<String>,
  features: Vec<FeatureSetting>,
}

impl ParsedParagraphRequest {
  pub(crate) fn as_request(&self) -> ParagraphRequest<'_> {
    ParagraphRequest {
      units: &self.units,
      location: &self.location,
      language: self.language.as_deref(),
      features: &self.features,
    }
  }
}

impl TryFrom<NapiParagraphRequest> for ParsedParagraphRequest {
  type Error = BridgeError;

  fn try_from(request: NapiParagraphRequest) -> BridgeResult<Self> {
    let units = request
      .units
      .into_iter()
      .map(shape_unit)
      .collect::<BridgeResult<_>>()?;
    let location = ExternalLocation::from_untyped(request.location.into_domain()?);
    let features = request
      .features
      .unwrap_or_default()
      .iter()
      .map(|setting| FeatureSetting::parse(&setting.tag, setting.value))
      .collect::<Result<_, _>>()?;

    Ok(Self {
      units,
      location,
      language: request.language,
      features,
    })
  }
}

fn shape_unit(unit: NapiShapeUnit) -> BridgeResult<ShapeUnit> {
  match (unit.codepoint, unit.glyph_id) {
    (Some(codepoint), None) => char::from_u32(codepoint)
      .map(ShapeUnit::Character)
      .ok_or_else(|| BridgeError::InvalidInput {
        kind: "codepoint",
        value: codepoint.to_string(),
      }),
    (None, Some(glyph_id)) => Ok(ShapeUnit::Glyph(parse::<GlyphId>(&glyph_id)?)),
    _ => Err(BridgeError::InvalidInput {
      kind: "shape unit",
      value: "needs exactly one of codepoint or glyphId".to_string(),
    }),
  }
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
        .map(|(axis_id, normalization)| NapiShaperAxis {
          axis_id: axis_id.to_string(),
          user: normalization
            .points()
            .iter()
            .map(|&(user, _)| user)
            .collect(),
          normalized: normalization
            .points()
            .iter()
            .map(|&(_, normalized)| normalized)
            .collect(),
        })
        .collect(),
    }
  }
}

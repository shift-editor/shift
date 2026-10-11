use napi_derive::napi;
use shift_backends::shaper_font::{
  FeatureSetting, ShapeRequest, ShapeUnit, ShapedGlyph, TextDirection,
};
use shift_font::{ExternalLocation, GlyphId};
use shift_wire::bridges::napi::NapiLocation;

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

#[napi(object)]
pub struct NapiShapeRequest {
  pub units: Vec<NapiShapeUnit>,
  /// User-space location to shape at; omitted axes are at their default.
  pub location: NapiLocation,
  /// Guessed from the script when omitted.
  #[napi(ts_type = "\"ltr\" | \"rtl\"")]
  pub direction: Option<String>,
  /// ISO 15924 script tag such as `Arab`; guessed from the characters when
  /// omitted.
  pub script: Option<String>,
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

/// A [`NapiShapeRequest`] with its inputs parsed into the types the shaper
/// takes.
pub(crate) struct ParsedShapeRequest {
  units: Vec<ShapeUnit>,
  location: ExternalLocation,
  direction: Option<TextDirection>,
  script: Option<String>,
  language: Option<String>,
  features: Vec<FeatureSetting>,
}

impl ParsedShapeRequest {
  pub(crate) fn as_request(&self) -> ShapeRequest<'_> {
    ShapeRequest {
      units: &self.units,
      location: &self.location,
      direction: self.direction,
      script: self.script.as_deref(),
      language: self.language.as_deref(),
      features: &self.features,
    }
  }
}

impl TryFrom<NapiShapeRequest> for ParsedShapeRequest {
  type Error = BridgeError;

  fn try_from(request: NapiShapeRequest) -> BridgeResult<Self> {
    let units = request
      .units
      .into_iter()
      .map(shape_unit)
      .collect::<BridgeResult<_>>()?;
    let location = ExternalLocation::from_untyped(crate::bridge::map_location(request.location)?);
    let direction = request
      .direction
      .as_deref()
      .map(text_direction)
      .transpose()?;
    let features = request
      .features
      .unwrap_or_default()
      .iter()
      .map(|setting| FeatureSetting::parse(&setting.tag, setting.value))
      .collect::<Result<_, _>>()?;

    Ok(Self {
      units,
      location,
      direction,
      script: request.script,
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

fn text_direction(direction: &str) -> BridgeResult<TextDirection> {
  match direction {
    "ltr" => Ok(TextDirection::LeftToRight),
    "rtl" => Ok(TextDirection::RightToLeft),
    _ => Err(BridgeError::InvalidInput {
      kind: "text direction",
      value: direction.to_string(),
    }),
  }
}

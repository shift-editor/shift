//! The compiled shaping tables, which the window's engine shapes text with
//! itself.

use std::sync::Arc;

use pack::{Bytes, Pack};
use shift_font::{AxisId, GlyphId};

use super::Bridge;
use crate::errors::{BridgeError, through_bridge_error};

/// The open workspace's shaping tables, compiled natively and shaped with in
/// the window.
#[pack::interface]
pub(crate) trait NativeShaping {
  /// The compiled shaping tables, or `None` when they are still at
  /// `known_revision`. Compiles them first when the font changed in a way
  /// they depend on: glyph order, glyph categories, feature code, or axes.
  ///
  /// # Errors
  ///
  /// Fails when no workspace is open or the tables cannot be compiled.
  fn shaper_font(
    &mut self,
    known_revision: Option<u32>,
  ) -> Result<Option<ShaperFont>, NativeShapingError>;
}

/// Why a [`NativeShaping`] request failed. Every variant carries the Rust error's
/// text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub(crate) enum NativeShapingError {
  /// The request compiles the open workspace's font, and none is open.
  #[error("{detail}")]
  NoWorkspace { detail: String },

  /// The tables could not be compiled. `detail` is the error's text: the
  /// error itself cannot cross the boundary.
  #[error("{detail}")]
  Failed { detail: String },
}

impl From<BridgeError> for NativeShapingError {
  fn from(error: BridgeError) -> Self {
    let detail = error.to_string();
    match error {
      BridgeError::NoWorkspace => Self::NoWorkspace { detail },
      _ => Self::Failed { detail },
    }
  }
}

through_bridge_error!(NativeShapingError);

/// The compiled shaping tables and what the editor needs to shape with them
/// itself: shaper glyph order and axis normalization.
#[derive(Clone, Debug, PartialEq, Pack)]
pub(crate) struct ShaperFont {
  /// Changes exactly when the tables do.
  pub revision: u32,
  /// The shaper font: `GSUB`, `GPOS`, `GDEF`, `head`, and `fvar`, with no
  /// outlines, `cmap`, or `hmtx`.
  pub bytes: Bytes,
  /// The Shift glyph at each shaper glyph id; `None` for a `.notdef` the
  /// font does not have.
  pub glyph_ids: Vec<Option<GlyphId>>,
  /// Each `fvar` axis, in order, with how its user coordinates normalize.
  pub axes: Vec<ShaperAxis>,
}

/// How one axis's user coordinates normalize: linear between mapping
/// points, clamped outside them.
#[derive(Clone, Debug, PartialEq, Pack)]
pub(crate) struct ShaperAxis {
  pub axis_id: AxisId,
  /// User coordinate at each mapping point, increasing.
  pub user: Vec<f64>,
  /// Normalized coordinate at each mapping point.
  pub normalized: Vec<f64>,
}

impl ShaperFont {
  fn new(revision: u64, font: &shift_backends::shaper_font::ShaperFont) -> Self {
    Self {
      revision: u32::try_from(revision).unwrap_or(u32::MAX),
      bytes: Bytes(font.bytes().to_vec()),
      glyph_ids: font.glyph_ids().to_vec(),
      axes: font
        .axis_normalizations()
        .into_iter()
        .map(|(axis_id, normalization)| ShaperAxis::new(axis_id, normalization.points()))
        .collect(),
    }
  }
}

impl ShaperAxis {
  /// The axis's normalization from its `(user, normalized)` mapping points.
  fn new(axis_id: AxisId, points: &[(f64, f64)]) -> Self {
    let (user, normalized) = points.iter().copied().unzip();
    Self {
      axis_id,
      user,
      normalized,
    }
  }
}

impl NativeShaping for Bridge {
  fn shaper_font(
    &mut self,
    known_revision: Option<u32>,
  ) -> Result<Option<ShaperFont>, NativeShapingError> {
    let font = Arc::clone(self.live_shaper()?.font());
    let revision = self.shaper_fonts.revision();
    if known_revision.is_some_and(|known| u64::from(known) == revision) {
      return Ok(None);
    }
    Ok(Some(ShaperFont::new(revision, &font)))
  }
}

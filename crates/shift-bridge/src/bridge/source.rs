//! A font file opened for browsing rather than editing: its directory read
//! once, and its glyphs read one at a time, without a workspace or store.

use pack::Pack;
use shift_font::GlyphId;
use shift_wire::{FontSnapshot, GlyphSnapshot};
use std::path::Path;

use super::{Bridge, RetainedSource};
use crate::errors::{BridgeError, through_bridge_error};

/// The font source the utility process has open for browsing, as the glyph
/// catalog previews it. Opening one closes the workspace.
#[pack::interface]
pub(crate) trait NativeSource {
  /// Opens the font file at `path` for browsing, closing the workspace and
  /// any font source, and returns its directory.
  ///
  /// # Errors
  ///
  /// Fails when the file cannot be read as a font.
  fn open_font_source(&mut self, path: String) -> Result<FontSnapshot, NativeSourceError>;

  /// Closes the font source, if one is open, with the atlases built from it.
  fn close_font_source(&mut self);

  /// One glyph of the font source, independent of any location, and every
  /// glyph its components use.
  ///
  /// # Errors
  ///
  /// Fails when no font source is open, the glyph is not in it, or its
  /// outline cannot be read.
  fn read_font_source_glyph(
    &self,
    glyph_id: GlyphId,
  ) -> Result<Vec<GlyphSnapshot>, NativeSourceError>;
}

/// Why a [`NativeSource`] request failed. Every variant carries the Rust error's
/// text as `detail`, which TypeScript's `PackError` ends its message with.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub(crate) enum NativeSourceError {
  /// The request reads the font source, and none is open.
  #[error("{detail}")]
  NoFontSource { detail: String },

  /// The request named something the font source does not have. `detail`
  /// is the error's text.
  #[error("{detail}")]
  InvalidInput { detail: String },

  /// The font could not be read. `detail` is the error's text: the error
  /// itself cannot cross the boundary.
  #[error("{detail}")]
  Failed { detail: String },
}

impl From<BridgeError> for NativeSourceError {
  fn from(error: BridgeError) -> Self {
    let detail = error.to_string();
    match error {
      BridgeError::NoFontSource => Self::NoFontSource { detail },
      BridgeError::InvalidInput { .. } | BridgeError::Wire(_) => Self::InvalidInput { detail },
      _ => Self::Failed { detail },
    }
  }
}

through_bridge_error!(NativeSourceError);

impl NativeSource for Bridge {
  fn open_font_source(&mut self, path: String) -> Result<FontSnapshot, NativeSourceError> {
    let source = RetainedSource::open(Path::new(&path))?;
    let snapshot = source.snapshot()?;
    self.workspace = None;
    self.retained_source = Some(source);
    self.slug_atlas = None;
    self.source_atlas_descriptors.clear();
    Ok(snapshot)
  }

  fn close_font_source(&mut self) {
    self.retained_source = None;
    self.slug_atlas = None;
    self.source_atlas_descriptors.clear();
  }

  fn read_font_source_glyph(
    &self,
    glyph_id: GlyphId,
  ) -> Result<Vec<GlyphSnapshot>, NativeSourceError> {
    Ok(self.retained_source()?.glyph(glyph_id)?)
  }
}

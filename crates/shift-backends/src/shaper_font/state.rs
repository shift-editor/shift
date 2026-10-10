use std::sync::Arc;

use super::{FeatureDiagnostic, ShaperFont, ShaperFontError, ShaperFontRequest};

/// The shaper font for a changing font: the most recent successful
/// compilation, and the diagnostics of the most recent request.
///
/// A request whose feature source has errors keeps the previous font active,
/// so shaping continues with the last valid features while the author repairs
/// the source.
#[derive(Debug, Default)]
pub struct ShaperFontState {
    request: Option<ShaperFontRequest>,
    font: Option<Arc<ShaperFont>>,
    diagnostics: Vec<FeatureDiagnostic>,
    revision: u64,
}

impl ShaperFontState {
    /// Compiles `request` unless it equals the last request, and returns
    /// whether the active font changed.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError`] as [`ShaperFont::compile`] does; the active
    /// font and diagnostics are then unchanged and the request is retried on
    /// the next update.
    pub fn update(&mut self, request: ShaperFontRequest) -> Result<bool, ShaperFontError> {
        if self.request.as_ref() == Some(&request) {
            return Ok(false);
        }

        let compilation = ShaperFont::compile(&request)?;
        self.request = Some(request);
        self.diagnostics = compilation.diagnostics;
        let Some(font) = compilation.font else {
            return Ok(false);
        };

        self.font = Some(Arc::new(font));
        self.revision += 1;
        Ok(true)
    }

    /// Returns the last successfully compiled font, or `None` when no request
    /// has compiled yet.
    pub fn font(&self) -> Option<&Arc<ShaperFont>> {
        self.font.as_ref()
    }

    /// Returns the diagnostics of the most recent request, including when its
    /// source failed and an earlier font remains active.
    pub fn diagnostics(&self) -> &[FeatureDiagnostic] {
        &self.diagnostics
    }

    /// Counts successful compilations; it changes exactly when
    /// [`Self::font`] does.
    pub fn revision(&self) -> u64 {
        self.revision
    }
}

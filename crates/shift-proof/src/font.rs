//! Loads a font for proofing as compiled bytes plus what the source knows.

use std::path::Path;

use shift_backends::font_loader::FontLoader;
use shift_backends::{FontExporter, FontView};
use shift_font::AxisRole;

use crate::definition::UserLocation;
use crate::ProofError;

/// A font ready to proof: compiled bytes, and the source document's
/// sources when it has any.
pub struct ProofFont {
    data: Vec<u8>,
    sources: SourceLocations,
    /// The file the font came from, for the proof header.
    source_name: Option<String>,
}

/// Where the font's sources sit in user space, for `"across": "sources"`.
#[derive(Clone, Debug)]
enum SourceLocations {
    Available(Vec<(String, UserLocation)>),
    Unavailable(&'static str),
}

impl ProofFont {
    /// Opens any font Shift reads. TrueType and OpenType files are proofed as
    /// they are; every other format, including `.shift`, is loaded into the
    /// Shift model and compiled in memory, so proofs show the font as built.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read, loaded, or compiled.
    pub fn open(path: &Path) -> Result<Self, ProofError> {
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(extension.as_str(), "ttf" | "otf") {
            let data = std::fs::read(path)
                .map_err(|error| ProofError::Load(format!("{}: {error}", path.display())))?;
            return Ok(Self::from_compiled(data).named(path));
        }

        let path_text = path
            .to_str()
            .ok_or_else(|| ProofError::Load("font path is not valid UTF-8".into()))?;
        let font = FontLoader::new()
            .read_font(path_text)
            .map_err(|error| ProofError::Load(format!("{}: {error}", path.display())))?;
        Ok(Self::compile(&font)?.named(path))
    }

    fn named(mut self, path: &Path) -> Self {
        self.source_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        self
    }

    /// Proofs already compiled TrueType or OpenType bytes.
    pub fn from_compiled(data: Vec<u8>) -> Self {
        Self {
            data,
            sources: SourceLocations::Unavailable(
                "a compiled font has no sources; proof the source document instead",
            ),
            source_name: None,
        }
    }

    /// Compiles a Shift font model for proofing.
    ///
    /// The whole font is compiled: a glyph subset would drop the kerning and
    /// features a proof exists to show.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::Compile`] when the font does not compile.
    pub fn compile(font: &impl FontView) -> Result<Self, ProofError> {
        let data = FontExporter::new()
            .compile_ttf(font)
            .map_err(|error| ProofError::Compile(error.to_string()))?;
        Ok(Self {
            data,
            sources: source_locations(font),
            source_name: None,
        })
    }

    pub(crate) fn source_name(&self) -> Option<&str> {
        self.source_name.as_deref()
    }

    pub(crate) fn data(&self) -> &[u8] {
        &self.data
    }

    /// Every master source's name and user-space location.
    pub(crate) fn sources(&self) -> Result<&[(String, UserLocation)], ProofError> {
        match &self.sources {
            SourceLocations::Available(sources) => Ok(sources),
            SourceLocations::Unavailable(reason) => Err(ProofError::Location((*reason).into())),
        }
    }
}

/// Sources are stored at design locations; a proof shapes at user-space
/// locations. Without axis mappings the two coincide. With mappings, an exact
/// source would need the inverse mapping, which Shift does not compute yet.
fn source_locations(font: &impl FontView) -> SourceLocations {
    if !font.axis_mappings().is_empty() {
        return SourceLocations::Unavailable(
            "proofing across sources needs an inverse axis mapping, which is not supported yet; \
             use \"instances\" or an axis sweep",
        );
    }
    let axes: Vec<_> = font
        .axes()
        .iter()
        .filter(|axis| axis.role() == AxisRole::External)
        .collect();
    SourceLocations::Available(
        font.sources()
            .iter()
            .filter(|source| source.is_master())
            .map(|source| {
                let location = axes
                    .iter()
                    .map(|axis| {
                        let value = source.location().get(&axis.id()).unwrap_or(axis.default());
                        (axis.tag().to_string(), value as f32)
                    })
                    .collect();
                (source.name().to_string(), location)
            })
            .collect(),
    )
}

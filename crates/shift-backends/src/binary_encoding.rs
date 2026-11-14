//! The file encodings a compiled binary is written in: plain TrueType, and
//! WOFF2 for the web, encoded from the same compiled bytes.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::atomic::write_file_atomic;
use crate::export::ExportError;

/// One file encoding of a compiled font binary.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum BinaryEncoding {
    /// The compiled TrueType bytes as they are.
    Ttf,
    /// The TrueType bytes WOFF2-encoded: transformed and Brotli-compressed
    /// for the web.
    Woff2,
}

impl BinaryEncoding {
    /// Every encoding, in the order exports write them.
    pub const ALL: [Self; 2] = [Self::Ttf, Self::Woff2];

    /// Returns the lowercase token commands and the bridge use, which is
    /// also the file extension.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ttf => "ttf",
            Self::Woff2 => "woff2",
        }
    }
}

impl TryFrom<&str> for BinaryEncoding {
    type Error = ExportError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let token = value.to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|encoding| encoding.as_str() == token)
            .ok_or(ExportError::UnsupportedEncoding { encoding: token })
    }
}

/// The encodings one binary export writes, in [`BinaryEncoding::ALL`]
/// order; never empty.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BinaryEncodings(BTreeSet<BinaryEncoding>);

impl BinaryEncodings {
    /// Plain TrueType only, as exports write by default.
    pub fn ttf() -> Self {
        Self(BTreeSet::from([BinaryEncoding::Ttf]))
    }

    /// The encodings in `encodings`, each once.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::NoEncodings`] when `encodings` is empty, since
    /// such an export would write nothing.
    pub fn new(encodings: impl IntoIterator<Item = BinaryEncoding>) -> Result<Self, ExportError> {
        let encodings: BTreeSet<_> = encodings.into_iter().collect();
        if encodings.is_empty() {
            return Err(ExportError::NoEncodings);
        }
        Ok(Self(encodings))
    }

    /// The file each encoding writes for a binary named after `ttf_path`:
    /// the same name with the encoding's extension.
    pub fn paths(&self, ttf_path: &Path) -> Vec<PathBuf> {
        self.0
            .iter()
            .map(|encoding| ttf_path.with_extension(encoding.as_str()))
            .collect()
    }

    /// Writes `ttf` in each encoding beside `ttf_path`, each file
    /// atomically, and returns the files in [`Self::paths`] order.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::EncodeWoff2`] when the binary cannot be WOFF2
    /// encoded and [`ExportError::WriteOutput`] when a file cannot be
    /// written.
    pub(crate) fn write(&self, ttf: &[u8], ttf_path: &Path) -> Result<Vec<PathBuf>, ExportError> {
        let mut written = Vec::new();
        for (encoding, path) in self.0.iter().zip(self.paths(ttf_path)) {
            let bytes = match encoding {
                BinaryEncoding::Ttf => ttf.to_vec(),
                BinaryEncoding::Woff2 => {
                    ttf2woff2::encode(ttf, ttf2woff2::BrotliQuality::default()).map_err(
                        |source| ExportError::EncodeWoff2 {
                            path: path.clone(),
                            source,
                        },
                    )?
                }
            };
            write_file_atomic(&path, &bytes).map_err(|source| ExportError::WriteOutput {
                path: path.clone(),
                source,
            })?;
            written.push(path);
        }
        Ok(written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_encoding_names_its_file_after_the_ttf() {
        let encodings = BinaryEncodings::new([BinaryEncoding::Woff2, BinaryEncoding::Ttf]).unwrap();

        assert_eq!(
            encodings.paths(Path::new("fonts/Solenoid[RESO].ttf")),
            [
                PathBuf::from("fonts/Solenoid[RESO].ttf"),
                PathBuf::from("fonts/Solenoid[RESO].woff2"),
            ]
        );
    }

    #[test]
    fn an_export_must_write_some_encoding() {
        assert!(matches!(
            BinaryEncodings::new([]),
            Err(ExportError::NoEncodings)
        ));
        assert!(matches!(
            BinaryEncoding::try_from("woff"),
            Err(ExportError::UnsupportedEncoding { .. })
        ));
    }
}

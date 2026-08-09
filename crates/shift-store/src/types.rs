use std::time::Duration;

use shift_font::{Glyph, LayerId};

use crate::layer::StoredLayerPayload;

const DOCUMENT_ID_PREFIX: &str = "document_";
const DOCUMENT_ID_BYTES: usize = 16;
const DOCUMENT_ID_HEX_LENGTH: usize = DOCUMENT_ID_BYTES * 2;

pub(crate) type EncodedGlyphLayers = Vec<Vec<(LayerId, Vec<u8>)>>;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LayerBatchTiming {
    pub pack_elapsed: Duration,
    pub compression_elapsed: Duration,
    pub sqlite_elapsed: Duration,
}

pub struct GlyphWriteBatch {
    pub(crate) glyphs: Vec<PackedGlyph>,
    pub(crate) pack_elapsed: Duration,
    pub(crate) compression_elapsed: Duration,
}

impl GlyphWriteBatch {
    pub fn pack_elapsed(&self) -> Duration {
        self.pack_elapsed
    }

    pub fn compression_elapsed(&self) -> Duration {
        self.compression_elapsed
    }
}

pub(crate) struct PackedGlyph {
    pub(crate) glyph: Glyph,
    pub(crate) layers: Vec<(LayerId, StoredLayerPayload)>,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DocumentId(String);

impl DocumentId {
    pub fn new() -> Self {
        let mut bytes = [0; DOCUMENT_ID_BYTES];
        getrandom::fill(&mut bytes).expect("secure random document ID generation failed");
        let suffix = bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();

        Self(format!("{DOCUMENT_ID_PREFIX}{suffix}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_stored(value: String) -> Option<Self> {
        let suffix = value.strip_prefix(DOCUMENT_ID_PREFIX)?;
        let valid = suffix.len() == DOCUMENT_ID_HEX_LENGTH
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'));

        valid.then_some(Self(value))
    }
}

impl Default for DocumentId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for DocumentId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct AxisId(String);

impl AxisId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct SourceId(String);

impl SourceId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct GlyphId(String);

impl GlyphId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct RevisionId(i64);

impl RevisionId {
    pub fn new(id: i64) -> Self {
        Self(id)
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

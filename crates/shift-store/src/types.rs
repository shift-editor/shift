use std::time::Duration;

use shift_font::{Glyph, LayerId};

use crate::layer::StoredLayerPayload;

const DOCUMENT_ID_PREFIX: &str = "document_";
const COMMIT_ID_PREFIX: &str = "commit_";
const RANDOM_ID_BYTES: usize = 16;
const RANDOM_ID_HEX_LENGTH: usize = RANDOM_ID_BYTES * 2;

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
        Self(random_id(DOCUMENT_ID_PREFIX, "document"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_stored(value: String) -> Option<Self> {
        let suffix = value.strip_prefix(DOCUMENT_ID_PREFIX)?;
        let valid = valid_random_id_suffix(suffix);

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

/// Durable identity of one explicitly saved canonical document revision.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CommitId(String);

impl CommitId {
    pub fn new() -> Self {
        Self(random_id(COMMIT_ID_PREFIX, "commit"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_stored(value: String) -> Option<Self> {
        let suffix = value.strip_prefix(COMMIT_ID_PREFIX)?;
        valid_random_id_suffix(suffix).then_some(Self(value))
    }
}

impl Default for CommitId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for CommitId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

fn random_id(prefix: &str, kind: &str) -> String {
    let mut bytes = [0; RANDOM_ID_BYTES];
    getrandom::fill(&mut bytes)
        .unwrap_or_else(|_| panic!("secure random {kind} ID generation failed"));
    let suffix = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    format!("{prefix}{suffix}")
}

fn valid_random_id_suffix(suffix: &str) -> bool {
    suffix.len() == RANDOM_ID_HEX_LENGTH
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
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

use std::time::Duration;

use shift_font::{Glyph, LayerId};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct LayerBatchTiming {
    pub pack_elapsed: Duration,
    pub compression_elapsed: Duration,
    pub sqlite_elapsed: Duration,
}

pub struct PackedGlyphBatch {
    pub(crate) glyphs: Vec<PackedGlyph>,
    pub(crate) pack_elapsed: Duration,
    pub(crate) compression_elapsed: Duration,
}

impl PackedGlyphBatch {
    pub fn pack_elapsed(&self) -> Duration {
        self.pack_elapsed
    }

    pub fn compression_elapsed(&self) -> Duration {
        self.compression_elapsed
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LayerPayloadCompression {
    None,
    ZstandardV1,
}

impl LayerPayloadCompression {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ZstandardV1 => "zstd.v1",
        }
    }
}

pub(crate) struct StoredGlyphLayer {
    pub(crate) compression: LayerPayloadCompression,
    pub(crate) bytes: Vec<u8>,
    pub(crate) stored_byte_length: u64,
    pub(crate) decoded_byte_length: u64,
    pub(crate) decoded_blake3: [u8; 32],
}

pub(crate) struct PackedGlyph {
    pub(crate) glyph: Glyph,
    pub(crate) layers: Vec<(LayerId, StoredGlyphLayer)>,
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

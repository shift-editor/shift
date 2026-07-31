use std::time::Duration;

use shift_font::{Glyph, LayerId};

use crate::StoreError;

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

impl TryFrom<&str> for LayerPayloadCompression {
    type Error = StoreError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "none" => Ok(Self::None),
            "zstd.v1" => Ok(Self::ZstandardV1),
            value => Err(StoreError::UnsupportedLayerCompression(value.to_owned())),
        }
    }
}

pub(crate) struct StoredLayerPayload {
    pub(crate) compression: LayerPayloadCompression,
    pub(crate) bytes: Vec<u8>,
    pub(crate) stored_byte_length: u64,
    pub(crate) decoded_byte_length: u64,
    pub(crate) decoded_blake3: [u8; 32],
}

pub(crate) struct PackedGlyph {
    pub(crate) glyph: Glyph,
    pub(crate) layers: Vec<(LayerId, StoredLayerPayload)>,
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
